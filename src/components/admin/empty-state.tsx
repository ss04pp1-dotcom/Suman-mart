import { cn } from "@/lib/utils";

export function AdminEmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border p-12 text-center", className)}>
      <div className="rounded-2xl bg-muted p-3.5 text-muted-foreground">
        <Icon className="h-6 w-6" />
      </div>
      <div>
        <p className="font-semibold">{title}</p>
        {description && <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
