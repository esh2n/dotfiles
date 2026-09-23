# Concurrency Pattern Catalog

Short sketches, not complete programs. Sources verified in `sources.md`.

## Worker pool (errgroup.SetLimit)

Prefer `errgroup` with `SetLimit` over a hand-rolled `make(chan struct{}, n)`
semaphore — it also gives first-error propagation and context cancellation
for free ([pkg.go.dev/golang.org/x/sync/errgroup](https://pkg.go.dev/golang.org/x/sync/errgroup)).

```go
func processAll(ctx context.Context, items []Item) error {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(20) // at most 20 concurrent

    for _, item := range items {
        g.Go(func() error {
            return process(ctx, item)
        })
    }
    return g.Wait() // first error, or nil
}
```

## Pipeline

Stages connected by channels; each stage owns and closes its own output
channel, and stops sending once its input closes.

```go
func square(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for n := range in {
            out <- n * n
        }
    }()
    return out
}
```

## or-done (cancellable read)

Wrap a channel read in a `select` against `ctx.Done()` so a blocked
send/receive can't leak the goroutine when the consumer walks away.

```go
func orDone(ctx context.Context, in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for {
            select {
            case v, ok := <-in:
                if !ok {
                    return
                }
                select {
                case out <- v:
                case <-ctx.Done():
                    return
                }
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

## Fan-in

Merge N input channels into one. The merger closes `out` only after a
`WaitGroup` covering every input goroutine completes — no single input
owns the close.

```go
func merge(ctx context.Context, ins ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(len(ins))
    for _, in := range ins {
        go func(in <-chan int) {
            defer wg.Done()
            for v := range orDone(ctx, in) {
                out <- v
            }
        }(in)
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

## Bounded semaphore (semaphore.Weighted)

Use when the resource being bounded isn't "one goroutine" but a weighted
cost — memory budget, connection slots of varying size — rather than a
uniform count
([pkg.go.dev/golang.org/x/sync/semaphore](https://pkg.go.dev/golang.org/x/sync/semaphore)).

```go
var sem = semaphore.NewWeighted(int64(maxWeight))

func doWork(ctx context.Context, cost int64) error {
    if err := sem.Acquire(ctx, cost); err != nil {
        return err // ctx canceled while waiting
    }
    defer sem.Release(cost)
    return work()
}
```

For plain "N goroutines at a time" with no per-unit cost, `errgroup.SetLimit`
above is usually less code than `semaphore.Weighted`.

## singleflight (deduplicate concurrent identical work)

When many goroutines might request the same expensive computation for the
same key at once (e.g. a cache-miss fetch), collapse them into one in-flight
call
([pkg.go.dev/golang.org/x/sync/singleflight](https://pkg.go.dev/golang.org/x/sync/singleflight)).

```go
var g singleflight.Group

func getUser(ctx context.Context, id string) (*User, error) {
    v, err, _ := g.Do(id, func() (any, error) {
        return fetchUserFromDB(ctx, id)
    })
    if err != nil {
        return nil, err
    }
    return v.(*User), nil
}
```

Every concurrent caller with the same key gets the same result from the one
in-flight call — no duplicate DB hits, no extra locking.

## Rate limiting (x/time/rate)

Token-bucket limiter: `NewLimiter(r, b)` allows a sustained rate `r`
events/sec with burst capacity `b`
([pkg.go.dev/golang.org/x/time/rate](https://pkg.go.dev/golang.org/x/time/rate)).

```go
lim := rate.NewLimiter(rate.Limit(10), 5) // 10/s sustained, burst of 5

func handle(ctx context.Context, req Request) error {
    if err := lim.Wait(ctx); err != nil {
        return err // ctx canceled while waiting for a token
    }
    return process(req)
}
```

Use `lim.Allow()` for a non-blocking check instead when the caller shouldn't
wait, or `lim.Reserve()` to get a delay without committing to wait for it.

## Graceful shutdown

`signal.NotifyContext` derives a context that's canceled on the listed
signals, the parent's own cancellation, or an explicit `stop()` — whichever
comes first ([pkg.go.dev/os/signal](https://pkg.go.dev/os/signal#NotifyContext)).

```go
func run() error {
    ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
    defer stop()

    srv := &http.Server{Addr: ":8080"}
    errCh := make(chan error, 1)
    go func() { errCh <- srv.ListenAndServe() }()

    select {
    case err := <-errCh:
        return err
    case <-ctx.Done():
        shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
        defer cancel()
        return srv.Shutdown(shutdownCtx)
    }
}
```

`context.WithoutCancel(ctx)` is deliberate here: `ctx` is already canceled
(that's why we're shutting down), but `Shutdown` still needs a live context
with its own timeout, not one that's already done.

## Ticker/timer reset rules (post-1.23)

Go 1.23 made `Timer`/`Ticker` channels synchronous (capacity 0, not a
buffered 1-slot channel), and `Stop`/`Reset` now guarantee that no later
receive observes a stale tick once they return
([go.dev/wiki/Go123Timer](https://go.dev/wiki/Go123Timer)). The old
"drain the channel before `Reset`" idiom is unnecessary on 1.23+ and should
not be added to new code; it's still *correct* on lower `go` directives,
just extra.

```go
t := time.NewTimer(d)
defer t.Stop()
for {
    select {
    case <-t.C:
        doWork()
        t.Reset(d) // 1.23+: no drain needed first
    case <-ctx.Done():
        return
    }
}
```

## Range-over-func iterator constraints (1.23+)

`iter.Seq[V]`/`iter.Seq2[K,V]` are plain functions taking a `yield`
callback; the `range` loop calls the iterator directly, so the iterator
body and the loop body run in the **same goroutine** unless the iterator
itself spawns one. Don't assume an iterator is safe to consume from
multiple goroutines concurrently, or that yielding from a goroutine other
than the one driving `range` is supported — the language spec doesn't
define that, so treat the iterator as goroutine-affine unless its own docs
say otherwise.

```go
func Lines(r io.Reader) iter.Seq[string] {
    return func(yield func(string) bool) {
        sc := bufio.NewScanner(r)
        for sc.Scan() {
            if !yield(sc.Text()) {
                return
            }
        }
    }
}
```
