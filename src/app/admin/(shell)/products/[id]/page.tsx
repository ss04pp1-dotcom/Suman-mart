import { use } from "react";
import { ProductEditor } from "@/components/admin/product-editor";

export default function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ProductEditor productId={id} />;
}
