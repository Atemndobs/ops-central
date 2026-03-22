import { PropertyDetail } from "@/components/properties/property-detail";

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <PropertyDetail id={id} />;
}
