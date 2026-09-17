import Image from "next/image";

type GalleryImage = {
  id: string;
  url: string;
  alt: string | null;
  width: number;
  height: number;
};

/**
 * The product's photographs, as a swipeable strip.
 *
 * Built from CSS scroll-snap and anchor links rather than JavaScript: swiping
 * is the browser's own horizontal scroll, and each thumbnail is an `<a>` whose
 * target sits inside the scroller, so tapping one scrolls it into view natively.
 * That keeps this page at zero client JS like the listing page, and means the
 * gallery works while a slow connection is still fetching everything else.
 */
export function ProductGallery({ images, title }: { images: GalleryImage[]; title: string }) {
  if (images.length === 0) {
    return (
      <div className="flex aspect-3/4 items-center justify-center rounded-xl bg-neutral-100 text-sm text-neutral-400 dark:bg-neutral-900">
        No photographs yet
      </div>
    );
  }

  const single = images.length === 1;

  return (
    <div className="space-y-3">
      <div
        className={`flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth ${
          // A single photograph should not look like a carousel that failed.
          single ? "" : "-mx-4 px-4 sm:mx-0 sm:px-0"
        }`}
      >
        {images.map((image, index) => (
          <figure
            key={image.id}
            id={`photo-${index + 1}`}
            className="w-full shrink-0 snap-center scroll-mt-24"
          >
            <Image
              src={image.url}
              alt={image.alt ?? `${title}, view ${index + 1}`}
              width={image.width}
              height={image.height}
              // One image occupies the whole column: full width on a phone, half
              // the layout on a wide screen.
              sizes="(min-width: 1024px) 50vw, 100vw"
              // The first photograph is this page's largest contentful paint.
              priority={index === 0}
              className="aspect-3/4 w-full rounded-xl bg-neutral-100 object-cover dark:bg-neutral-900"
            />
          </figure>
        ))}
      </div>

      {!single && (
        <nav aria-label="Photographs" className="flex gap-2">
          {images.map((image, index) => (
            <a
              key={image.id}
              href={`#photo-${index + 1}`}
              aria-label={`View photograph ${index + 1} of ${images.length}`}
              className="w-16 shrink-0 overflow-hidden rounded-lg ring-offset-2 focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:outline-none dark:focus-visible:ring-neutral-100"
            >
              <Image
                src={image.url}
                alt=""
                width={image.width}
                height={image.height}
                sizes="64px"
                className="aspect-3/4 w-full object-cover opacity-70 transition hover:opacity-100"
              />
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}
