package llm

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// structuredInputLimit is the largest input file, in bytes.
const structuredInputLimit = 2 << 20

// StructuredRequest is what a caller holding no key asks of a tier: the two
// texts, and the JSON Schema of the object it wants back.
type StructuredRequest struct {
	System string
	User   string
	Schema json.RawMessage
}

// LoadStructuredRequest reads and parses the input file. Its messages name
// the file and the field at fault, never the file's content.
func LoadStructuredRequest(path string) (StructuredRequest, error) {
	f, err := os.Open(path)
	if err != nil {
		return StructuredRequest{}, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, structuredInputLimit+1))
	if err != nil {
		return StructuredRequest{}, err
	}
	if len(data) > structuredInputLimit {
		return StructuredRequest{}, fmt.Errorf("%s is over 2 MiB", path)
	}
	r, err := parseStructuredRequest(data)
	if err != nil {
		return StructuredRequest{}, fmt.Errorf("%s: %w", path, err)
	}
	return r, nil
}

func parseStructuredRequest(data []byte) (StructuredRequest, error) {
	var v struct {
		System string          `json:"system"`
		User   string          `json:"user"`
		Schema json.RawMessage `json:"schema"`
	}
	if err := json.Unmarshal(data, &v); err != nil {
		return StructuredRequest{}, errors.New("not valid JSON of the form {system, user, schema}")
	}
	if v.System == "" {
		return StructuredRequest{}, errors.New(`"system" is missing`)
	}
	if v.User == "" {
		return StructuredRequest{}, errors.New(`"user" is missing`)
	}
	if !bytes.HasPrefix(v.Schema, []byte("{")) {
		return StructuredRequest{}, errors.New(`"schema" must be an object`)
	}
	return StructuredRequest{System: v.System, User: v.User, Schema: v.Schema}, nil
}

// Structured asks a tier for one JSON object through the local LiteLLM and
// returns it compacted, its numbers as the model wrote them. The message of
// every failure is built here from fixed text and the HTTP status, because a
// gateway's error body and a model's answer can both repeat what they were
// sent. The object is not checked against the schema: it is model output, so
// the caller validates it and treats its strings as untrusted.
func Structured(e Env, tier string, r StructuredRequest, timeout time.Duration) (json.RawMessage, error) {
	if timeout <= 0 {
		return nil, fmt.Errorf("the timeout must be positive, not %s", timeout)
	}
	e = e.withDefaults()
	if err := checkTier(e.Repo, tier); err != nil {
		return nil, err
	}
	key := e.proxyKey()
	if key == "" {
		return nil, errors.New("the LiteLLM key did not resolve (litellm/proxy-key.sh)")
	}
	payload, err := chatPayload(tier, r)
	if err != nil {
		return nil, err
	}
	body, status, err := e.call(http.MethodPost, e.URLs.LiteLLM+"/v1/chat/completions", key, payload, timeout)
	if err != nil {
		var t interface{ Timeout() bool }
		if errors.As(err, &t) && t.Timeout() {
			return nil, fmt.Errorf("no answer within %s", timeout)
		}
		return nil, err
	}
	if status/100 != 2 {
		return nil, fmt.Errorf("LiteLLM answered %d", status)
	}
	return parseChatAnswer(body)
}

// checkTier refuses a tier harness/policy/tiers.json does not name.
func checkTier(repo, tier string) error {
	path := filepath.Join(repo, "harness", "policy", "tiers.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var doc struct {
		Tiers map[string]json.RawMessage `json:"tiers"`
	}
	if err := json.Unmarshal(data, &doc); err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	if _, ok := doc.Tiers[tier]; ok {
		return nil
	}
	names := make([]string, 0, len(doc.Tiers))
	for name := range doc.Tiers {
		names = append(names, name)
	}
	sort.Strings(names)
	return fmt.Errorf("unknown tier %q (one of %s)", tier, strings.Join(names, ", "))
}

// structuredMaxTokens is the main tier's own cap. It bounds what one call can
// spend, and reasoning is likely counted in it, so a much lower cap risks a
// blank answer.
const structuredMaxTokens = 16384

// chatPayload asks for json_object with the schema in the system text:
// DeepSeek, which the main and complex tiers run on, takes only `text` or
// `json_object` (https://api-docs.deepseek.com/api/create-chat-completion),
// although LiteLLM's model map marks deepseek-flash supports_response_schema.
// Its JSON Output also needs the word "json" in the prompt
// (https://api-docs.deepseek.com/guides/json_mode).
// The executor tier sends no response_format, because its Mac deployment, LM
// Studio, answers 400 to json_object and may leave content empty under
// json_schema (lmstudio-bug-tracker issues 189 and 1773); parseChatAnswer
// still refuses anything but one object.
func chatPayload(tier string, r StructuredRequest) ([]byte, error) {
	type message struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}
	format := map[string]string{"type": "json_object"}
	if tier == "executor" {
		format = nil
	}
	return json.Marshal(struct {
		Model          string            `json:"model"`
		Messages       []message         `json:"messages"`
		ResponseFormat map[string]string `json:"response_format,omitempty"`
		MaxTokens      int               `json:"max_tokens"`
	}{
		Model: tier,
		Messages: []message{
			{"system", r.System + "\n\nAnswer with one JSON object and nothing else. It must conform to this JSON Schema:\n" + string(r.Schema)},
			{"user", r.User},
		},
		ResponseFormat: format,
		MaxTokens:      structuredMaxTokens,
	})
}

// parseChatAnswer takes the first choice's text out of a chat completion and
// parses it. A null content, which a tool call leaves, reads as blank; blank
// is also how DeepSeek's JSON Output reports output it could not read as JSON.
func parseChatAnswer(body []byte) (json.RawMessage, error) {
	var v struct {
		Choices []struct {
			FinishReason string `json:"finish_reason"`
			Message      struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(body, &v); err != nil {
		return nil, errors.New("LiteLLM's reply is not a chat completion")
	}
	if len(v.Choices) == 0 {
		return nil, errors.New("LiteLLM's reply holds no answer")
	}
	switch v.Choices[0].FinishReason {
	case "length":
		return nil, errors.New("the model's answer was cut off at the output cap")
	case "content_filter":
		return nil, errors.New("the provider's filter stopped the answer")
	}
	text := unfence(strings.TrimSpace(v.Choices[0].Message.Content))
	if text == "" {
		return nil, errors.New("the model's answer is empty")
	}
	if !strings.HasPrefix(text, "{") || !json.Valid([]byte(text)) {
		return nil, errors.New("the model's answer is not a JSON object")
	}
	var out bytes.Buffer
	if err := json.Compact(&out, []byte(text)); err != nil {
		return nil, errors.New("the model's answer is not a JSON object")
	}
	return out.Bytes(), nil
}

// unfence removes a Markdown code fence that wraps the whole text.
func unfence(text string) string {
	inner, opened := strings.CutPrefix(text, "```")
	inner, closed := strings.CutSuffix(inner, "```")
	if !opened || !closed {
		return text
	}
	if len(inner) >= 4 && strings.EqualFold(inner[:4], "json") {
		inner = inner[4:]
	}
	return strings.TrimSpace(inner)
}
