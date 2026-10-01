"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface HeroBanner {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string;
  buttonLabel: string | null;
  buttonUrl: string | null;
}

export function HeroCarousel({ banners }: { banners: HeroBanner[] }) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: banners.length > 1, duration: 28 });
  const [selected, setSelected] = useState(0);

  const onSelect = useCallback(() => {
    if (emblaApi) setSelected(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.on("select", onSelect);
    const timer = setInterval(() => emblaApi.scrollNext(), 6000);
    return () => {
      emblaApi.off("select", onSelect);
      clearInterval(timer);
    };
  }, [emblaApi, onSelect]);

  if (banners.length === 0) return null;

  return (
    <section aria-label="Featured promotions" className="relative">
      <div className="overflow-hidden rounded-3xl" ref={emblaRef}>
        <div className="flex">
          {banners.map((b) => (
            <div key={b.id} className="relative min-w-0 flex-[0_0_100%]">
              <div className="relative aspect-[16/10] w-full sm:aspect-[21/9]">
                <Image
                  src={b.imageUrl}
                  alt={b.title}
                  fill
                  priority
                  sizes="(max-width: 768px) 100vw, 1200px"
                  className="object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-slate-950/80 via-slate-950/40 to-transparent" />
                <div className="absolute inset-0 flex flex-col justify-center gap-3 p-6 sm:max-w-lg sm:p-12">
                  <h1 className="text-2xl font-extrabold leading-tight text-white text-balance sm:text-4xl lg:text-5xl">
                    {b.title}
                  </h1>
                  {b.subtitle && (
                    <p className="max-w-md text-sm text-slate-200 sm:text-base">{b.subtitle}</p>
                  )}
                  {b.buttonUrl && (
                    <Button asChild className="mt-2 w-fit rounded-full px-6 shadow-lg">
                      <Link href={b.buttonUrl}>
                        {b.buttonLabel ?? "Shop Now"} <ArrowRight className="ml-1.5 h-4 w-4" />
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {banners.length > 1 && (
        <>
          <button
            onClick={() => emblaApi?.scrollPrev()}
            aria-label="Previous banner"
            className="absolute left-3 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/90 p-2.5 text-slate-900 shadow-lg transition hover:bg-white sm:block"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => emblaApi?.scrollNext()}
            aria-label="Next banner"
            className="absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/90 p-2.5 text-slate-900 shadow-lg transition hover:bg-white sm:block"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2">
            {banners.map((_, i) => (
              <button
                key={i}
                onClick={() => emblaApi?.scrollTo(i)}
                aria-label={`Go to banner ${i + 1}`}
                className={cn(
                  "h-2 rounded-full transition-all",
                  i === selected ? "w-7 bg-white" : "w-2 bg-white/50 hover:bg-white/75"
                )}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
