export function FoodImage({
  src,
  alt,
  eager = false,
}: {
  src: string;
  alt: string;
  eager?: boolean;
}) {
  return (
    <img
      src={src}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      onError={(e) => {
        if (!e.currentTarget.src.endsWith('/images/placeholder.svg'))
          e.currentTarget.src = '/images/placeholder.svg';
      }}
    />
  );
}
