'use client';

import dynamic from 'next/dynamic';

const NewGoodsReceiptContent = dynamic(
  () => import('./NewGoodsReceiptContent'),
  {
    ssr: false,
    loading: () => (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="text-gray-500">加载中...</div>
      </div>
    )
  }
);

export default function NewGoodsReceiptPage() {
  return <NewGoodsReceiptContent />;
}
