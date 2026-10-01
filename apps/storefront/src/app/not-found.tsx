import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <div className="rounded-2xl bg-brand-50 p-4 text-brand-600 dark:bg-brand-100">
        <Compass className="h-10 w-10" />
      </div>
      <h1 className="text-3xl font-extrabold">Page not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The page you are looking for does not exist or may have been moved.
      </p>
      <div className="mt-2 flex gap-3">
        <Button asChild className="rounded-full">
          <Link href="/">Back to Store</Link>
        </Button>
        <Button asChild variant="outline" className="rounded-full">
          <Link href="/products">Browse Products</Link>
        </Button>
      </div>
    </div>
  );
}
