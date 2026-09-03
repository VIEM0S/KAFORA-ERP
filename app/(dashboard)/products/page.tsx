'use client';

import { useState, useEffect, Suspense } from 'react';
import { Plus, Upload } from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/hooks/store';
import { useSearchParams, useRouter } from 'next/navigation';
import { useProductsData } from '@/hooks/use-products-data';
import { ProductsFilters } from '@/components/products/products-filters';
import { ProductsTable } from '@/components/products/products-table';
import { ProductFormDialog } from '@/components/products/product-form-dialog';
import { DeleteProductDialog } from '@/components/products/delete-product-dialog';
import { isManagerPlus } from '@/lib/auth/roles';
import type { Product } from '@/lib/types';

function ProductsPageInner() {
  const { tenant, user } = useAuthStore();
  const tenantId = tenant?.id;
  // products_write (RLS) exige is_manager() — voir components/products/products-table.tsx.
  const canManage = isManagerPlus(user?.role);
  const router = useRouter();
  const searchParams = useSearchParams();

  const { products, categories, isLoading } = useProductsData(tenantId);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  const [showDialog, setShowDialog] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);

  const openAdd = () => { setEditingProduct(null); setShowDialog(true); };
  const openEdit = (p: Product) => { setEditingProduct(p); setShowDialog(true); };

  // Ouvrir le dialog si ?new=1
  useEffect(() => {
    if (searchParams.get('new') === '1') openAdd();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const filtered = products.filter((p) => {
    const matchSearch =
      !searchQuery ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.barcode || '').includes(searchQuery);
    const matchCat = filterCategory === 'all' || p.categoryId === filterCategory;
    const matchStatus =
      filterStatus === 'all' ||
      (filterStatus === 'active' && p.isActive) ||
      (filterStatus === 'inactive' && !p.isActive);
    return matchSearch && matchCat && matchStatus;
  });

  const lowStock = products.filter(
    (p) => p.isActive && p.trackInventory &&
      (p.inventory?.[0]?.quantity ?? 0) <= p.alertThreshold
  ).length;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Produits</h1>
            <p className="text-sm text-gray-500 mt-1">
              {products.length} produit{products.length !== 1 ? 's' : ''} au total
              {lowStock > 0 && <span className="ml-2 text-amber-600 font-medium">· {lowStock} en stock faible</span>}
            </p>
          </div>
          {canManage && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => router.push('/products/import')}>
                <Upload className="h-4 w-4 mr-2" />Importer en masse
              </Button>
              <Button onClick={openAdd} className="bg-primary-600 hover:bg-primary-700">
                <Plus className="h-4 w-4 mr-2" />Nouveau produit
              </Button>
            </div>
          )}
        </div>

        <ProductsFilters
          searchQuery={searchQuery} setSearchQuery={setSearchQuery}
          filterCategory={filterCategory} setFilterCategory={setFilterCategory}
          filterStatus={filterStatus} setFilterStatus={setFilterStatus}
          categories={categories}
        />

        <ProductsTable
          tenantId={tenantId}
          products={products}
          filtered={filtered}
          categories={categories}
          isLoading={isLoading}
          searchQuery={searchQuery}
          onOpenAdd={openAdd}
          onEdit={openEdit}
          onDelete={setDeleteTarget}
          canManage={canManage}
        />
      </div>

      <ProductFormDialog
        tenantId={tenantId}
        open={showDialog}
        editingProduct={editingProduct}
        categories={categories}
        onOpenChange={setShowDialog}
      />

      <DeleteProductDialog
        tenantId={tenantId}
        product={deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
      />
    </DashboardLayout>
  );
}

export default function ProductsPage() {
  return (
    <Suspense fallback={null}>
      <ProductsPageInner />
    </Suspense>
  );
}
