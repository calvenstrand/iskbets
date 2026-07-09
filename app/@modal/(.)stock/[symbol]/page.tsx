import { StockDetail } from "@/components/StockDetail";
import { StockDetailModal } from "@/components/StockDetailModal";

// Intercepting route: in-app taps on a dashboard card land here instead
// of the full page, rendering the same server <StockDetail> inside the
// client modal shell. Direct links / refresh bypass this and hit
// app/stock/[symbol]/page.tsx. Only the shell differs.
export const revalidate = 60;
export const dynamicParams = true;

type Params = Promise<{ symbol: string }>;

export default async function InterceptedStockModal({
  params,
}: {
  params: Params;
}) {
  const { symbol } = await params;
  return (
    <StockDetailModal>
      <StockDetail symbol={symbol} />
    </StockDetailModal>
  );
}
