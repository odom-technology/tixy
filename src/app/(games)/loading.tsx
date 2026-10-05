export default function GamesLoading() {
  return (
    <div className='page-shell max-w-none space-y-8'>
      <div className='arcade-card h-44 animate-pulse' />
      <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className='arcade-card-inset h-32 animate-pulse'
          />
        ))}
      </div>
    </div>
  );
}
