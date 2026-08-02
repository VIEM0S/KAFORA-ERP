import { Edit, Trash2, Package, AlertTriangle, RefreshCw, ChevronDown, Plus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatCurrency } from '@/lib/utils/helpers';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { tenantCol } from '@/lib/firebase/collections';
import type { Product, Category } from '@/lib/types';

interface ProductsTableProps {
  tenantId: string | undefined;
  products: Product[];
  filtered: Product[];
  categories: Category[];
  isLoading: boolean;
  searchQuery: string;
  onOpenAdd: () => void;
  onEdit: (p: Product) => void;
  onDelete: (p: Product) => void;
}

export function ProductsTable({
  tenantId, products, filtered, categories, isLoading, searchQuery, onOpenAdd, onEdit, onDelete,
}: ProductsTableProps) {
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? '—';

  // null si le prix d'achat n'est pas renseigné : on n'invente pas une marge.
  const margin = (p: Product) =>
    p.purchasePrice != null && p.purchasePrice > 0
      ? Math.round(((p.sellingPrice - p.purchasePrice) / p.purchasePrice) * 100)
      : null;

  const toggleStatus = async (p: Product) => {
    if (!tenantId) return;
    await updateDoc(doc(db, tenantCol(tenantId, 'products'), p.id), {
      isActive: !p.isActive,
      updatedAt: serverTimestamp(),
    });
  };

  return (
    <Card>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <RefreshCw className="h-6 w-6 animate-spin mr-3" />
            Chargement des produits...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Package className="h-12 w-12 mb-4 opacity-30" />
            <p className="font-medium">Aucun produit trouvé</p>
            {!searchQuery && products.length === 0 && (
              <Button onClick={onOpenAdd} variant="outline" className="mt-4">
                <Plus className="h-4 w-4 mr-2" />
                Ajouter votre premier produit
              </Button>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produit</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Catégorie</TableHead>
                <TableHead className="text-right">Prix achat</TableHead>
                <TableHead className="text-right">Prix vente</TableHead>
                <TableHead className="text-right">Marge</TableHead>
                <TableHead className="text-center">Statut</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => {
                const m = margin(p);
                const stock = p.inventory?.[0]?.quantity ?? null;
                const isLow = stock !== null && stock <= p.alertThreshold;
                return (
                  <TableRow key={p.id} className="hover:bg-gray-50">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                          <Package className="h-4 w-4 text-gray-400" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900 text-sm">{p.name}</p>
                          {isLow && (
                            <p className="text-xs text-amber-600 flex items-center gap-1 mt-0.5">
                              <AlertTriangle className="h-3 w-3" />
                              Stock faible ({stock})
                            </p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{p.sku}</code>
                    </TableCell>
                    <TableCell className="text-sm text-gray-500">{catName(p.categoryId)}</TableCell>
                    <TableCell className="text-right text-sm">
                      {p.purchasePrice == null
                        ? <span className="text-amber-600" title="Prix d'achat non renseigné — ce produit est exclu des marges et de la valeur du stock">non renseigné</span>
                        : formatCurrency(p.purchasePrice)}
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium">{formatCurrency(p.sellingPrice)}</TableCell>
                    <TableCell className="text-right">
                      {m !== null ? (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          m >= 25 ? 'bg-green-100 text-green-700' :
                          m >= 10 ? 'bg-amber-100 text-amber-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {m}%
                        </span>
                      ) : <span className="text-xs text-gray-400">—</span>}
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch checked={p.isActive} onCheckedChange={() => toggleStatus(p)} />
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onEdit(p)}>
                            <Edit className="h-4 w-4 mr-2" />
                            Modifier
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => onDelete(p)} className="text-red-600 focus:text-red-600">
                            <Trash2 className="h-4 w-4 mr-2" />
                            Supprimer
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
