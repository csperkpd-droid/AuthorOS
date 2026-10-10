/** Review is loading: the page's shape, without content. */
export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading comments">
      <div className="h-9 w-40 animate-pulse rounded-md bg-muted" />
      <div className="h-9 w-full max-w-md animate-pulse rounded-md bg-muted" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}
