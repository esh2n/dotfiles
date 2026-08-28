/* @ts-self-types="./lindera_wasm.d.ts" */

/**
 * Compression algorithm for dictionary data.
 * @enum {0 | 1 | 2 | 3}
 */
const CompressionAlgorithm = Object.freeze({
    Deflate: 0, "0": "Deflate",
    Zlib: 1, "1": "Zlib",
    Gzip: 2, "2": "Gzip",
    Raw: 3, "3": "Raw",
});
exports.CompressionAlgorithm = CompressionAlgorithm;

/**
 * A morphological analysis dictionary.
 */
class Dictionary {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Dictionary.prototype);
        obj.__wbg_ptr = ptr;
        DictionaryFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        DictionaryFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_dictionary_free(ptr, 0);
    }
    /**
     * @returns {string}
     */
    get encoding() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.jsdictionary_encoding(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {Metadata}
     */
    get metadata() {
        const ret = wasm.jsdictionary_metadata(this.__wbg_ptr);
        return Metadata.__wrap(ret);
    }
    /**
     * @returns {string}
     */
    get name() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.jsdictionary_name(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) Dictionary.prototype[Symbol.dispose] = Dictionary.prototype.free;
exports.Dictionary = Dictionary;

/**
 * Field definition in dictionary schema.
 */
class FieldDefinition {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(FieldDefinition.prototype);
        obj.__wbg_ptr = ptr;
        FieldDefinitionFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        FieldDefinitionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_fielddefinition_free(ptr, 0);
    }
    /**
     * @returns {string | undefined}
     */
    get description() {
        const ret = wasm.__wbg_get_fielddefinition_description(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * @returns {FieldType}
     */
    get field_type() {
        const ret = wasm.__wbg_get_fielddefinition_field_type(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get index() {
        const ret = wasm.__wbg_get_fielddefinition_index(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {string}
     */
    get name() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.__wbg_get_fielddefinition_name(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {number} index
     * @param {string} name
     * @param {FieldType} field_type
     * @param {string | null} [description]
     */
    constructor(index, name, field_type, description) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(description) ? 0 : passStringToWasm0(description, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.jsfielddefinition_new(index, ptr0, len0, field_type, ptr1, len1);
        this.__wbg_ptr = ret >>> 0;
        FieldDefinitionFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {string | null} [arg0]
     */
    set description(arg0) {
        var ptr0 = isLikeNone(arg0) ? 0 : passStringToWasm0(arg0, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_fielddefinition_description(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {FieldType} arg0
     */
    set field_type(arg0) {
        wasm.__wbg_set_fielddefinition_field_type(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set index(arg0) {
        wasm.__wbg_set_fielddefinition_index(this.__wbg_ptr, arg0);
    }
    /**
     * @param {string} arg0
     */
    set name(arg0) {
        const ptr0 = passStringToWasm0(arg0, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_fielddefinition_name(this.__wbg_ptr, ptr0, len0);
    }
}
if (Symbol.dispose) FieldDefinition.prototype[Symbol.dispose] = FieldDefinition.prototype.free;
exports.FieldDefinition = FieldDefinition;

/**
 * Field type in dictionary schema.
 * @enum {0 | 1 | 2 | 3 | 4}
 */
const FieldType = Object.freeze({
    /**
     * Surface form (word text)
     */
    Surface: 0, "0": "Surface",
    /**
     * Left context ID for morphological analysis
     */
    LeftContextId: 1, "1": "LeftContextId",
    /**
     * Right context ID for morphological analysis
     */
    RightContextId: 2, "2": "RightContextId",
    /**
     * Word cost (used in path selection)
     */
    Cost: 3, "3": "Cost",
    /**
     * Custom field (morphological features)
     */
    Custom: 4, "4": "Custom",
});
exports.FieldType = FieldType;

/**
 * Error type for Lindera operations.
 */
class LinderaError {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        LinderaErrorFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_linderaerror_free(ptr, 0);
    }
    /**
     * @returns {string}
     */
    get message() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.__wbg_get_linderaerror_message(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {string} message
     */
    constructor(message) {
        const ptr0 = passStringToWasm0(message, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.jslinderaerror_new(ptr0, len0);
        this.__wbg_ptr = ret >>> 0;
        LinderaErrorFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {string}
     */
    toString() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.jslinderaerror_toString(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {string} arg0
     */
    set message(arg0) {
        const ptr0 = passStringToWasm0(arg0, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_linderaerror_message(this.__wbg_ptr, ptr0, len0);
    }
}
if (Symbol.dispose) LinderaError.prototype[Symbol.dispose] = LinderaError.prototype.free;
exports.LinderaError = LinderaError;

/**
 * Dictionary metadata configuration.
 */
class Metadata {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Metadata.prototype);
        obj.__wbg_ptr = ptr;
        MetadataFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        MetadataFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_metadata_free(ptr, 0);
    }
    /**
     * @returns {CompressionAlgorithm}
     */
    get compress_algorithm() {
        const ret = wasm.jsmetadata_compress_algorithm(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Metadata}
     */
    static createDefault() {
        const ret = wasm.jsmetadata_createDefault();
        return Metadata.__wrap(ret);
    }
    /**
     * @returns {Schema}
     */
    get dictionary_schema() {
        const ret = wasm.jsmetadata_dictionary_schema(this.__wbg_ptr);
        return Schema.__wrap(ret);
    }
    /**
     * @returns {string}
     */
    get encoding() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.jsmetadata_encoding(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get name() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.jsmetadata_name(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {string | null} [name]
     * @param {string | null} [encoding]
     * @param {CompressionAlgorithm | null} [compress_algorithm]
     */
    constructor(name, encoding, compress_algorithm) {
        var ptr0 = isLikeNone(name) ? 0 : passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(encoding) ? 0 : passStringToWasm0(encoding, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.jsmetadata_new(ptr0, len0, ptr1, len1, isLikeNone(compress_algorithm) ? 4 : compress_algorithm);
        this.__wbg_ptr = ret >>> 0;
        MetadataFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {CompressionAlgorithm} algorithm
     */
    set compress_algorithm(algorithm) {
        wasm.jsmetadata_set_compress_algorithm(this.__wbg_ptr, algorithm);
    }
    /**
     * @param {Schema} schema
     */
    set dictionary_schema(schema) {
        _assertClass(schema, Schema);
        var ptr0 = schema.__destroy_into_raw();
        wasm.jsmetadata_set_dictionary_schema(this.__wbg_ptr, ptr0);
    }
    /**
     * @param {string} encoding
     */
    set encoding(encoding) {
        const ptr0 = passStringToWasm0(encoding, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.jsmetadata_set_encoding(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {string} name
     */
    set name(name) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.jsmetadata_set_name(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {Schema} schema
     */
    set user_dictionary_schema(schema) {
        _assertClass(schema, Schema);
        var ptr0 = schema.__destroy_into_raw();
        wasm.jsmetadata_set_user_dictionary_schema(this.__wbg_ptr, ptr0);
    }
    /**
     * @returns {Schema}
     */
    get user_dictionary_schema() {
        const ret = wasm.jsmetadata_user_dictionary_schema(this.__wbg_ptr);
        return Schema.__wrap(ret);
    }
}
if (Symbol.dispose) Metadata.prototype[Symbol.dispose] = Metadata.prototype.free;
exports.Metadata = Metadata;

/**
 * Tokenization mode.
 *
 * Determines how text is segmented into tokens.
 * @enum {0 | 1}
 */
const Mode = Object.freeze({
    /**
     * Standard tokenization based on dictionary cost
     */
    Normal: 0, "0": "Normal",
    /**
     * Decompose compound words using penalty-based segmentation
     */
    Decompose: 1, "1": "Decompose",
});
exports.Mode = Mode;

/**
 * Penalty configuration for decompose mode.
 *
 * Controls how aggressively compound words are decomposed based on
 * character type and length thresholds.
 */
class Penalty {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PenaltyFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_penalty_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get kanji_penalty_length_penalty() {
        const ret = wasm.__wbg_get_penalty_kanji_penalty_length_penalty(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get kanji_penalty_length_threshold() {
        const ret = wasm.__wbg_get_penalty_kanji_penalty_length_threshold(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get other_penalty_length_penalty() {
        const ret = wasm.__wbg_get_penalty_other_penalty_length_penalty(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get other_penalty_length_threshold() {
        const ret = wasm.__wbg_get_penalty_other_penalty_length_threshold(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number | null} [kanji_penalty_length_threshold]
     * @param {number | null} [kanji_penalty_length_penalty]
     * @param {number | null} [other_penalty_length_threshold]
     * @param {number | null} [other_penalty_length_penalty]
     */
    constructor(kanji_penalty_length_threshold, kanji_penalty_length_penalty, other_penalty_length_threshold, other_penalty_length_penalty) {
        const ret = wasm.jspenalty_new(isLikeNone(kanji_penalty_length_threshold) ? 0x100000001 : (kanji_penalty_length_threshold) >>> 0, isLikeNone(kanji_penalty_length_penalty) ? 0x100000001 : (kanji_penalty_length_penalty) >> 0, isLikeNone(other_penalty_length_threshold) ? 0x100000001 : (other_penalty_length_threshold) >>> 0, isLikeNone(other_penalty_length_penalty) ? 0x100000001 : (other_penalty_length_penalty) >> 0);
        this.__wbg_ptr = ret >>> 0;
        PenaltyFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {number} arg0
     */
    set kanji_penalty_length_penalty(arg0) {
        wasm.__wbg_set_penalty_kanji_penalty_length_penalty(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set kanji_penalty_length_threshold(arg0) {
        wasm.__wbg_set_penalty_kanji_penalty_length_threshold(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set other_penalty_length_penalty(arg0) {
        wasm.__wbg_set_penalty_other_penalty_length_penalty(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set other_penalty_length_threshold(arg0) {
        wasm.__wbg_set_penalty_other_penalty_length_threshold(this.__wbg_ptr, arg0);
    }
}
if (Symbol.dispose) Penalty.prototype[Symbol.dispose] = Penalty.prototype.free;
exports.Penalty = Penalty;

/**
 * Dictionary schema definition.
 */
class Schema {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Schema.prototype);
        obj.__wbg_ptr = ptr;
        SchemaFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SchemaFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_schema_free(ptr, 0);
    }
    /**
     * @returns {Schema}
     */
    static create_default() {
        const ret = wasm.jsschema_create_default();
        return Schema.__wrap(ret);
    }
    /**
     * @returns {number}
     */
    field_count() {
        const ret = wasm.jsschema_field_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {string[]}
     */
    get_all_fields() {
        const ret = wasm.jsschema_get_all_fields(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {string[]}
     */
    get_custom_fields() {
        const ret = wasm.jsschema_get_custom_fields(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {string} name
     * @returns {FieldDefinition | undefined}
     */
    get_field_by_name(name) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.jsschema_get_field_by_name(this.__wbg_ptr, ptr0, len0);
        return ret === 0 ? undefined : FieldDefinition.__wrap(ret);
    }
    /**
     * @param {string} field_name
     * @returns {number | undefined}
     */
    get_field_index(field_name) {
        const ptr0 = passStringToWasm0(field_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.jsschema_get_field_index(this.__wbg_ptr, ptr0, len0);
        return ret === 0x100000001 ? undefined : ret;
    }
    /**
     * @param {number} index
     * @returns {string | undefined}
     */
    get_field_name(index) {
        const ret = wasm.jsschema_get_field_name(this.__wbg_ptr, index);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * @param {string[]} fields
     */
    constructor(fields) {
        const ptr0 = passArrayJsValueToWasm0(fields, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.jsschema_new(ptr0, len0);
        this.__wbg_ptr = ret >>> 0;
        SchemaFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) Schema.prototype[Symbol.dispose] = Schema.prototype.free;
exports.Schema = Schema;

/**
 * Core segmenter for morphological analysis.
 */
class Segmenter {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SegmenterFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_segmenter_free(ptr, 0);
    }
}
if (Symbol.dispose) Segmenter.prototype[Symbol.dispose] = Segmenter.prototype.free;
exports.Segmenter = Segmenter;

/**
 * Token object wrapping the Rust Token data.
 *
 * This class provides robust access to token field and details.
 */
class Token {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Token.prototype);
        obj.__wbg_ptr = ptr;
        TokenFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        TokenFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_token_free(ptr, 0);
    }
    /**
     * End byte position in the original text.
     * @returns {number}
     */
    get byte_end() {
        const ret = wasm.__wbg_get_token_byte_end(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Start byte position in the original text.
     * @returns {number}
     */
    get byte_start() {
        const ret = wasm.__wbg_get_token_byte_start(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Morphological details of the token.
     * @returns {string[]}
     */
    get details() {
        const ret = wasm.__wbg_get_token_details(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Whether this token is an unknown word (not found in the dictionary).
     * @returns {boolean}
     */
    get is_unknown() {
        const ret = wasm.__wbg_get_token_is_unknown(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Position index of the token.
     * @returns {number}
     */
    get position() {
        const ret = wasm.__wbg_get_token_position(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Surface form of the token.
     * @returns {string}
     */
    get surface() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.__wbg_get_token_surface(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Word ID in the dictionary.
     * @returns {number}
     */
    get word_id() {
        const ret = wasm.__wbg_get_token_word_id(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * End byte position in the original text.
     * @param {number} arg0
     */
    set byte_end(arg0) {
        wasm.__wbg_set_token_byte_end(this.__wbg_ptr, arg0);
    }
    /**
     * Start byte position in the original text.
     * @param {number} arg0
     */
    set byte_start(arg0) {
        wasm.__wbg_set_token_byte_start(this.__wbg_ptr, arg0);
    }
    /**
     * Morphological details of the token.
     * @param {string[]} arg0
     */
    set details(arg0) {
        const ptr0 = passArrayJsValueToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_token_details(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Whether this token is an unknown word (not found in the dictionary).
     * @param {boolean} arg0
     */
    set is_unknown(arg0) {
        wasm.__wbg_set_token_is_unknown(this.__wbg_ptr, arg0);
    }
    /**
     * Position index of the token.
     * @param {number} arg0
     */
    set position(arg0) {
        wasm.__wbg_set_token_position(this.__wbg_ptr, arg0);
    }
    /**
     * Surface form of the token.
     * @param {string} arg0
     */
    set surface(arg0) {
        const ptr0 = passStringToWasm0(arg0, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_token_surface(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Word ID in the dictionary.
     * @param {number} arg0
     */
    set word_id(arg0) {
        wasm.__wbg_set_token_word_id(this.__wbg_ptr, arg0);
    }
    /**
     * Returns the detail at the specified index.
     *
     * # Parameters
     *
     * - `index`: Index of the detail to retrieve.
     *
     * # Returns
     *
     * The detail string if found, otherwise undefined.
     * @param {number} index
     * @returns {string | undefined}
     */
    getDetail(index) {
        const ret = wasm.token_getDetail(this.__wbg_ptr, index);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * @returns {any}
     */
    toJSON() {
        const ret = wasm.token_toJSON(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) Token.prototype[Symbol.dispose] = Token.prototype.free;
exports.Token = Token;

/**
 * A tokenizer for morphological analysis.
 */
class Tokenizer {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Tokenizer.prototype);
        obj.__wbg_ptr = ptr;
        TokenizerFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        TokenizerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_tokenizer_free(ptr, 0);
    }
    /**
     * @param {Dictionary} dictionary
     * @param {string | null} [mode]
     * @param {UserDictionary | null} [user_dictionary]
     */
    constructor(dictionary, mode, user_dictionary) {
        _assertClass(dictionary, Dictionary);
        var ptr0 = dictionary.__destroy_into_raw();
        var ptr1 = isLikeNone(mode) ? 0 : passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        let ptr2 = 0;
        if (!isLikeNone(user_dictionary)) {
            _assertClass(user_dictionary, UserDictionary);
            ptr2 = user_dictionary.__destroy_into_raw();
        }
        const ret = wasm.tokenizer_new(ptr0, ptr1, len1, ptr2);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        TokenizerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Tokenizes the input text.
     * @param {string} input_text
     * @returns {Token[]}
     */
    tokenize(input_text) {
        const ptr0 = passStringToWasm0(input_text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.tokenizer_tokenize(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * Tokenizes the input text and returns N-best results.
     *
     * Returns an array of arrays, where each inner array contains Token JSON objects.
     * @param {string} input_text
     * @param {number} n
     * @param {boolean | null} [unique]
     * @param {bigint | null} [cost_threshold]
     * @returns {any}
     */
    tokenizeNbest(input_text, n, unique, cost_threshold) {
        const ptr0 = passStringToWasm0(input_text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.tokenizer_tokenizeNbest(this.__wbg_ptr, ptr0, len0, n, isLikeNone(unique) ? 0xFFFFFF : unique ? 1 : 0, !isLikeNone(cost_threshold), isLikeNone(cost_threshold) ? BigInt(0) : cost_threshold);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Tokenizes the input text and returns N-best results (snake_case alias).
     * @param {string} input_text
     * @param {number} n
     * @param {boolean | null} [unique]
     * @param {bigint | null} [cost_threshold]
     * @returns {any}
     */
    tokenize_nbest(input_text, n, unique, cost_threshold) {
        const ptr0 = passStringToWasm0(input_text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.tokenizer_tokenize_nbest(this.__wbg_ptr, ptr0, len0, n, isLikeNone(unique) ? 0xFFFFFF : unique ? 1 : 0, !isLikeNone(cost_threshold), isLikeNone(cost_threshold) ? BigInt(0) : cost_threshold);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) Tokenizer.prototype[Symbol.dispose] = Tokenizer.prototype.free;
exports.Tokenizer = Tokenizer;

/**
 * Builder for creating a [`Tokenizer`] instance.
 *
 * `TokenizerBuilder` provides a fluent API for configuring and building a tokenizer
 * with various options such as dictionary selection, tokenization mode, character filters,
 * and token filters.
 */
class TokenizerBuilder {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        TokenizerBuilderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_tokenizerbuilder_free(ptr, 0);
    }
    /**
     * Appends a character filter to the tokenization pipeline.
     * @param {string} name
     * @param {any} args
     */
    appendCharacterFilter(name, args) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.tokenizerbuilder_appendCharacterFilter(this.__wbg_ptr, ptr0, len0, args);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Appends a token filter to the tokenization pipeline.
     * @param {string} name
     * @param {any} args
     */
    appendTokenFilter(name, args) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.tokenizerbuilder_appendTokenFilter(this.__wbg_ptr, ptr0, len0, args);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {string} name
     * @param {any} args
     */
    append_character_filter(name, args) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.tokenizerbuilder_append_character_filter(this.__wbg_ptr, ptr0, len0, args);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {string} name
     * @param {any} args
     */
    append_token_filter(name, args) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.tokenizerbuilder_append_token_filter(this.__wbg_ptr, ptr0, len0, args);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Builds and returns a configured [`Tokenizer`] instance.
     * @returns {Tokenizer}
     */
    build() {
        const ptr = this.__destroy_into_raw();
        const ret = wasm.tokenizerbuilder_build(ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Tokenizer.__wrap(ret[0]);
    }
    /**
     * Creates a new `TokenizerBuilder` instance.
     */
    constructor() {
        const ret = wasm.tokenizerbuilder_new();
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        TokenizerBuilderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Sets the dictionary to use for tokenization.
     * @param {string} uri
     */
    setDictionary(uri) {
        const ptr0 = passStringToWasm0(uri, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.tokenizerbuilder_setDictionary(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Sets whether to keep whitespace tokens in the output.
     * @param {boolean} keep
     */
    setKeepWhitespace(keep) {
        const ret = wasm.tokenizerbuilder_setKeepWhitespace(this.__wbg_ptr, keep);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Sets the tokenization mode.
     * @param {string} mode
     */
    setMode(mode) {
        const ptr0 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.tokenizerbuilder_setMode(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Sets a user-defined dictionary.
     * @param {string} uri
     */
    setUserDictionary(uri) {
        const ptr0 = passStringToWasm0(uri, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.tokenizerbuilder_setUserDictionary(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {string} uri
     */
    set_dictionary(uri) {
        const ptr0 = passStringToWasm0(uri, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.tokenizerbuilder_set_dictionary(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {boolean} keep
     */
    set_keep_whitespace(keep) {
        const ret = wasm.tokenizerbuilder_set_keep_whitespace(this.__wbg_ptr, keep);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {string} mode
     */
    set_mode(mode) {
        const ptr0 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.tokenizerbuilder_set_mode(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {string} uri
     */
    set_user_dictionary(uri) {
        const ptr0 = passStringToWasm0(uri, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.tokenizerbuilder_set_user_dictionary(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
}
if (Symbol.dispose) TokenizerBuilder.prototype[Symbol.dispose] = TokenizerBuilder.prototype.free;
exports.TokenizerBuilder = TokenizerBuilder;

/**
 * A user-defined dictionary for custom words.
 */
class UserDictionary {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(UserDictionary.prototype);
        obj.__wbg_ptr = ptr;
        UserDictionaryFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        UserDictionaryFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_userdictionary_free(ptr, 0);
    }
}
if (Symbol.dispose) UserDictionary.prototype[Symbol.dispose] = UserDictionary.prototype.free;
exports.UserDictionary = UserDictionary;

/**
 * Builds a dictionary from source files.
 * @param {string} input_dir
 * @param {string} output_dir
 * @param {Metadata} metadata
 */
function buildDictionary(input_dir, output_dir, metadata) {
    const ptr0 = passStringToWasm0(input_dir, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(output_dir, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    _assertClass(metadata, Metadata);
    var ptr2 = metadata.__destroy_into_raw();
    const ret = wasm.buildDictionary(ptr0, len0, ptr1, len1, ptr2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}
exports.buildDictionary = buildDictionary;

/**
 * Builds a user dictionary from a CSV file.
 * @param {string} input_file
 * @param {string} output_dir
 * @param {Metadata | null} [metadata]
 */
function buildUserDictionary(input_file, output_dir, metadata) {
    const ptr0 = passStringToWasm0(input_file, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(output_dir, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    let ptr2 = 0;
    if (!isLikeNone(metadata)) {
        _assertClass(metadata, Metadata);
        ptr2 = metadata.__destroy_into_raw();
    }
    const ret = wasm.buildUserDictionary(ptr0, len0, ptr1, len1, ptr2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}
exports.buildUserDictionary = buildUserDictionary;

/**
 * @param {string} input_dir
 * @param {string} output_dir
 * @param {Metadata} metadata
 */
function build_dictionary(input_dir, output_dir, metadata) {
    const ptr0 = passStringToWasm0(input_dir, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(output_dir, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    _assertClass(metadata, Metadata);
    var ptr2 = metadata.__destroy_into_raw();
    const ret = wasm.build_dictionary(ptr0, len0, ptr1, len1, ptr2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}
exports.build_dictionary = build_dictionary;

/**
 * @param {string} input_file
 * @param {string} output_dir
 * @param {Metadata | null} [metadata]
 */
function build_user_dictionary(input_file, output_dir, metadata) {
    const ptr0 = passStringToWasm0(input_file, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(output_dir, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    let ptr2 = 0;
    if (!isLikeNone(metadata)) {
        _assertClass(metadata, Metadata);
        ptr2 = metadata.__destroy_into_raw();
    }
    const ret = wasm.build_user_dictionary(ptr0, len0, ptr1, len1, ptr2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}
exports.build_user_dictionary = build_user_dictionary;

/**
 * Gets the version of the lindera-wasm library.
 * Backward compatibility alias for version().
 * @returns {string}
 */
function getVersion() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.getVersion();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
exports.getVersion = getVersion;

/**
 * Loads a dictionary from the specified URI.
 * @param {string} uri
 * @returns {Dictionary}
 */
function loadDictionary(uri) {
    const ptr0 = passStringToWasm0(uri, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.loadDictionary(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Dictionary.__wrap(ret[0]);
}
exports.loadDictionary = loadDictionary;

/**
 * Loads a user dictionary from the specified URI.
 * @param {string} uri
 * @param {Metadata} metadata
 * @returns {UserDictionary}
 */
function loadUserDictionary(uri, metadata) {
    const ptr0 = passStringToWasm0(uri, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    _assertClass(metadata, Metadata);
    var ptr1 = metadata.__destroy_into_raw();
    const ret = wasm.loadUserDictionary(ptr0, len0, ptr1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return UserDictionary.__wrap(ret[0]);
}
exports.loadUserDictionary = loadUserDictionary;

/**
 * @param {string} uri
 * @returns {Dictionary}
 */
function load_dictionary(uri) {
    const ptr0 = passStringToWasm0(uri, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.load_dictionary(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Dictionary.__wrap(ret[0]);
}
exports.load_dictionary = load_dictionary;

/**
 * @param {string} uri
 * @param {Metadata} metadata
 * @returns {UserDictionary}
 */
function load_user_dictionary(uri, metadata) {
    const ptr0 = passStringToWasm0(uri, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    _assertClass(metadata, Metadata);
    var ptr1 = metadata.__destroy_into_raw();
    const ret = wasm.load_user_dictionary(ptr0, len0, ptr1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return UserDictionary.__wrap(ret[0]);
}
exports.load_user_dictionary = load_user_dictionary;

/**
 * Returns the version of the lindera-wasm package.
 * @returns {string}
 */
function version() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.version();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
exports.version = version;

function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_83742b46f01ce22d: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_String_8564e559799eccda: function(arg0, arg1) {
            const ret = String(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_bigint_get_as_i64_447a76b5c6ef7bda: function(arg0, arg1) {
            const v = arg1;
            const ret = typeof(v) === 'bigint' ? v : undefined;
            getDataViewMemory0().setBigInt64(arg0 + 8 * 1, isLikeNone(ret) ? BigInt(0) : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_boolean_get_c0f3f60bac5a78d1: function(arg0) {
            const v = arg0;
            const ret = typeof(v) === 'boolean' ? v : undefined;
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        },
        __wbg___wbindgen_debug_string_5398f5bb970e0daa: function(arg0, arg1) {
            const ret = debugString(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_in_41dbb8413020e076: function(arg0, arg1) {
            const ret = arg0 in arg1;
            return ret;
        },
        __wbg___wbindgen_is_bigint_e2141d4f045b7eda: function(arg0) {
            const ret = typeof(arg0) === 'bigint';
            return ret;
        },
        __wbg___wbindgen_is_function_3c846841762788c1: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_null_0b605fc6b167c56f: function(arg0) {
            const ret = arg0 === null;
            return ret;
        },
        __wbg___wbindgen_is_object_781bc9f159099513: function(arg0) {
            const val = arg0;
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_undefined_52709e72fb9f179c: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_jsval_eq_ee31bfad3e536463: function(arg0, arg1) {
            const ret = arg0 === arg1;
            return ret;
        },
        __wbg___wbindgen_jsval_loose_eq_5bcc3bed3c69e72b: function(arg0, arg1) {
            const ret = arg0 == arg1;
            return ret;
        },
        __wbg___wbindgen_number_get_34bb9d9dcfa21373: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'number' ? obj : undefined;
            getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_string_get_395e606bd0ee4427: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_6ddd609b62940d55: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_call_e133b57c9155d22c: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.call(arg1);
            return ret;
        }, arguments); },
        __wbg_done_08ce71ee07e3bd17: function(arg0) {
            const ret = arg0.done;
            return ret;
        },
        __wbg_entries_e8a20ff8c9757101: function(arg0) {
            const ret = Object.entries(arg0);
            return ret;
        },
        __wbg_get_326e41e095fb2575: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_get_a8ee5c45dabc1b3b: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_get_unchecked_329cfe50afab7352: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_instanceof_ArrayBuffer_101e2bf31071a9f6: function(arg0) {
            let result;
            try {
                result = arg0 instanceof ArrayBuffer;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Map_f194b366846aca0c: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Map;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Uint8Array_740438561a5b956d: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Uint8Array;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_isArray_33b91feb269ff46e: function(arg0) {
            const ret = Array.isArray(arg0);
            return ret;
        },
        __wbg_isSafeInteger_ecd6a7f9c3e053cd: function(arg0) {
            const ret = Number.isSafeInteger(arg0);
            return ret;
        },
        __wbg_iterator_d8f549ec8fb061b1: function() {
            const ret = Symbol.iterator;
            return ret;
        },
        __wbg_length_b3416cf66a5452c8: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_ea16607d7b61445b: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_new_5f486cdf45a04d78: function(arg0) {
            const ret = new Uint8Array(arg0);
            return ret;
        },
        __wbg_new_a70fbab9066b301f: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_new_ab79df5bd7c26067: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_next_11b99ee6237339e3: function() { return handleError(function (arg0) {
            const ret = arg0.next();
            return ret;
        }, arguments); },
        __wbg_next_e01a967809d1aa68: function(arg0) {
            const ret = arg0.next;
            return ret;
        },
        __wbg_prototypesetcall_d62e5099504357e6: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_push_e87b0e732085a946: function(arg0, arg1) {
            const ret = arg0.push(arg1);
            return ret;
        },
        __wbg_set_7eaa4f96924fd6b3: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_token_new: function(arg0) {
            const ret = Token.__wrap(arg0);
            return ret;
        },
        __wbg_value_21fc78aab0322612: function(arg0) {
            const ret = arg0.value;
            return ret;
        },
        __wbindgen_cast_0000000000000001: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0) {
            // Cast intrinsic for `I64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000003: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_cast_0000000000000004: function(arg0) {
            // Cast intrinsic for `U64 -> Externref`.
            const ret = BigInt.asUintN(64, arg0);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./lindera_wasm_bg.js": import0,
    };
}

const DictionaryFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_dictionary_free(ptr >>> 0, 1));
const FieldDefinitionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_fielddefinition_free(ptr >>> 0, 1));
const LinderaErrorFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_linderaerror_free(ptr >>> 0, 1));
const MetadataFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_metadata_free(ptr >>> 0, 1));
const PenaltyFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_penalty_free(ptr >>> 0, 1));
const SchemaFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_schema_free(ptr >>> 0, 1));
const SegmenterFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_segmenter_free(ptr >>> 0, 1));
const TokenFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_token_free(ptr >>> 0, 1));
const UserDictionaryFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_userdictionary_free(ptr >>> 0, 1));
const TokenizerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_tokenizer_free(ptr >>> 0, 1));
const TokenizerBuilderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_tokenizerbuilder_free(ptr >>> 0, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
    }
    wasm.__externref_drop_slice(ptr, len);
    return result;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArrayJsValueToWasm0(array, malloc) {
    const ptr = malloc(array.length * 4, 4) >>> 0;
    for (let i = 0; i < array.length; i++) {
        const add = addToExternrefTable0(array[i]);
        getDataViewMemory0().setUint32(ptr + 4 * i, add, true);
    }
    WASM_VECTOR_LEN = array.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
function decodeText(ptr, len) {
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

const wasmPath = `${__dirname}/lindera_wasm_bg.wasm`;
const wasmBytes = require('fs').readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
let wasm = new WebAssembly.Instance(wasmModule, __wbg_get_imports()).exports;
wasm.__wbindgen_start();
