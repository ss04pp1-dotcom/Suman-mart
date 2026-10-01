import Link from "next/link";
import { ChevronRight } from "lucide-react";

export function SectionHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string | null;
  action?: { label: string; href: string };
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4 sm:mb-6">
      <div>
        <h2 className="text-xl font-extrabold tracking-tight sm:text-2xl">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action && (
        <Link
          href={action.href}
          className="inline-flex shrink-0 items-center gap-0.5 rounded-full px-3 py-1.5 text-sm font-semibold text-brand-700 transition-all hover:gap-1.5 hover:bg-brand-50 dark:text-brand-600 dark:hover:bg-brand-100"
        >
          {action.label} <ChevronRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}
