import type {
  IUcpResource,
  SearchUcpCatalogParams,
  UcpSearchResult,
} from '@stripe/link-sdk';
import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback } from 'react';
import { useAsyncAction } from '../../hooks/use-async-action';

interface CatalogSearchProps {
  repository: IUcpResource;
  params: SearchUcpCatalogParams;
  onComplete: (result: UcpSearchResult | null) => void;
}

interface CatalogRow {
  sku: string;
  title: string;
  price: string;
  availability: string;
  merchant: string;
  business: string;
}

const TITLE_MAX_WIDTH = 30;

function formatPrice(price?: number, currency?: string): string {
  if (price == null) return '';
  return `$${(price / 100).toFixed(2)} ${(currency ?? 'usd').toUpperCase()}`;
}

function toRow(product: UcpSearchResult['data'][number]): CatalogRow {
  const firstVariant = product.variants?.[0];
  const sku = product.sku ?? product.sku_id ?? firstVariant?.merchant_sku;
  const title = product.title ?? product.name ?? firstVariant?.title;
  const priceAmount =
    product.sale_price ??
    product.price ??
    firstVariant?.price?.amount ??
    product.first_variant_price?.amount;
  const priceCurrency =
    product.currency ??
    firstVariant?.price?.currency ??
    product.first_variant_price?.currency;
  const availability =
    product.availability ?? firstVariant?.availability?.status;
  const business = product.profile_id ?? firstVariant?.profile_id;
  const merchant = product.merchant_name ?? firstVariant?.merchant_name;
  return {
    sku: sku ?? '—',
    title: title ?? '—',
    price: formatPrice(priceAmount, priceCurrency) || '—',
    availability: availability ?? '—',
    merchant: merchant ?? '—',
    business: business ?? '—',
  };
}

function truncate(value: string, width: number): string {
  if (value.length <= width) return value;
  return `${value.slice(0, Math.max(0, width - 1))}…`;
}

// Identifier columns (SKU, business) are never truncated — they must be
// copyable verbatim into `ucp checkout create`. Only the display-only title
// column is capped.
function columnWidths(rows: CatalogRow[]) {
  const widthOf = (header: string, values: string[], cap?: number) => {
    const max = Math.max(header.length, ...values.map((v) => v.length));
    return cap ? Math.min(max, cap) : max;
  };
  return {
    sku: widthOf(
      'SKU',
      rows.map((r) => r.sku),
    ),
    title: widthOf(
      'TITLE',
      rows.map((r) => r.title),
      TITLE_MAX_WIDTH,
    ),
    price: widthOf(
      'PRICE',
      rows.map((r) => r.price),
    ),
    availability: widthOf(
      'AVAIL',
      rows.map((r) => r.availability),
    ),
    merchant: widthOf(
      'MERCHANT',
      rows.map((r) => r.merchant),
    ),
  };
}

function formatRow(
  row: Record<'sku' | 'title' | 'price' | 'availability' | 'merchant', string>,
  business: string,
  widths: ReturnType<typeof columnWidths>,
): string {
  return [
    row.sku.padEnd(widths.sku),
    truncate(row.title, widths.title).padEnd(widths.title),
    row.price.padEnd(widths.price),
    row.availability.padEnd(widths.availability),
    row.merchant.padEnd(widths.merchant),
    business,
  ].join(' ');
}

export const CatalogSearch: React.FC<CatalogSearchProps> = ({
  repository,
  params,
  onComplete,
}) => {
  const { exit } = useApp();
  const action = useCallback(
    () => repository.searchCatalog(params),
    [repository, params],
  );
  const wrappedOnComplete = useCallback(
    (result: UcpSearchResult | null) => {
      onComplete(result);
      exit();
    },
    [onComplete, exit],
  );
  const { status, data, error } = useAsyncAction(action, wrappedOnComplete);

  if (status === 'loading') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> Searching catalog...
        </Text>
      </Box>
    );
  }

  if (status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Catalog search failed</Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  const products = data?.data ?? [];
  if (products.length === 0) {
    return (
      <Box>
        <Text dimColor>No products found</Text>
      </Box>
    );
  }

  const rows = products.map(toRow);
  const widths = columnWidths(rows);

  return (
    <Box flexDirection="column">
      <Text bold color="white">
        Catalog results{' '}
        <Text dimColor>
          ({data?.total_count ?? products.length}
          {data?.has_more ? '+' : ''})
        </Text>
      </Text>
      <Box flexDirection="column" marginTop={1} paddingX={2}>
        <Text bold color="white">
          {formatRow(
            {
              sku: 'SKU',
              title: 'TITLE',
              price: 'PRICE',
              availability: 'AVAIL',
              merchant: 'MERCHANT',
            },
            'BUSINESS',
            widths,
          )}
        </Text>
        {rows.map((row, index) => (
          <Text key={row.sku !== '—' ? row.sku : String(index)}>
            {formatRow(row, row.business, widths)}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          Create a checkout with a SKU and its business:{' '}
          <Text color="cyan">
            ucp checkout create --business &lt;BUSINESS&gt; --line-item
            "id:&lt;SKU&gt;,quantity:1"
          </Text>
        </Text>
      </Box>
    </Box>
  );
};
