import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { CartItem, Product, Customer, Store, User, Tenant, Notification } from '@/lib/types';

// ─── Auth Store ───────────────────────────────────────────────────────────────
// Stocke uniquement les données de profil (pas de token — géré par cookie HttpOnly)

interface AuthState {
  user: User | null;
  tenant: Tenant | null;
  currentStore: Store | null;
  stores: Store[];
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setTenant: (tenant: Tenant | null) => void;
  setCurrentStore: (store: Store | null) => void;
  setStores: (stores: Store[]) => void;
  setLoading: (loading: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      tenant: null,
      currentStore: null,
      stores: [],
      isLoading: true,
      setUser: (user) => set({ user }),
      setTenant: (tenant) => set({ tenant }),
      setCurrentStore: (store) => set({ currentStore: store }),
      setStores: (stores) => set({ stores }),
      setLoading: (loading) => set({ isLoading: loading }),
      logout: () =>
        set({ user: null, tenant: null, currentStore: null, stores: [], isLoading: false }),
    }),
    {
      name: 'erp-auth',
      storage: createJSONStorage(() => localStorage),
      // On ne persiste que les données de profil, jamais de token
      partialize: (state) => ({
        user: state.user,
        tenant: state.tenant,
        currentStore: state.currentStore,
        stores: state.stores,
      }),
    }
  )
);

// ─── Cart Store ───────────────────────────────────────────────────────────────

interface CartState {
  items: CartItem[];
  customerId: string | null;
  customer: Customer | null;
  discountPercent: number;
  discountReason: string | null;
  notes: string | null;
  // Devis en cours de conversion (voir app/(dashboard)/quotes/page.tsx) : lu
  // par le checkout pour faire passer le devis en "Converti" une fois la
  // vente réellement encaissée — jamais avant, sinon un panier abandonné
  // laisserait le devis marqué converti sans vente correspondante.
  sourceQuoteId: string | null;
  addItem: (product: Product, quantity?: number) => void;
  // Produit à suivi de série (product.trackSerial) : un numéro choisi au
  // POS = un exemplaire ajouté. Pas de addItem(quantity) classique, chaque
  // exemplaire est distinct — voir components/pos/serial-picker-dialog.tsx.
  addSerialItem: (product: Product, serial: string) => void;
  removeSerialFromItem: (productId: string, serial: string) => void;
  removeItem: (productId: string) => void;
  updateItemQuantity: (productId: string, quantity: number) => void;
  updateItemPrice: (productId: string, price: number) => void;
  clearCart: () => void;
  setCustomer: (customer: Customer | null) => void;
  setDiscount: (percent: number, reason: string | null) => void;
  setNotes: (notes: string | null) => void;
  setSourceQuoteId: (quoteId: string | null) => void;
  getSubtotal: () => number;
  getTax: () => number;
  getTotal: () => number;
  getItemCount: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      customerId: null,
      customer: null,
      discountPercent: 0,
      discountReason: null,
      notes: null,
      sourceQuoteId: null,

      addItem: (product, quantity = 1) => {
        const items = get().items;
        const existing = items.find((i) => i.product.id === product.id);

        if (existing) {
          set({
            items: items.map((i) =>
              i.product.id === product.id
                ? {
                    ...i,
                    quantity: i.quantity + quantity,
                    total:
                      (i.quantity + quantity) *
                      i.unitPrice *
                      (1 - i.discount / 100) *
                      (1 + i.tax / 100),
                  }
                : i
            ),
          });
        } else {
          const newItem: CartItem = {
            product,
            quantity,
            unitPrice: product.sellingPrice,
            discount: 0,
            tax: product.taxRate,
            total: quantity * product.sellingPrice * (1 + product.taxRate / 100),
          };
          set({ items: [...items, newItem] });
        }
      },

      addSerialItem: (product, serial) => {
        const items = get().items;
        const existing = items.find((i) => i.product.id === product.id);
        if (existing) {
          if ((existing.serials || []).includes(serial)) return; // déjà dans le panier
          const serials = [...(existing.serials || []), serial];
          set({
            items: items.map((i) =>
              i.product.id === product.id
                ? { ...i, serials, quantity: serials.length,
                    total: serials.length * i.unitPrice * (1 - i.discount / 100) * (1 + i.tax / 100) }
                : i
            ),
          });
        } else {
          const newItem: CartItem = {
            product, quantity: 1, unitPrice: product.sellingPrice, discount: 0, tax: product.taxRate,
            total: product.sellingPrice * (1 + product.taxRate / 100),
            serials: [serial],
          };
          set({ items: [...items, newItem] });
        }
      },

      removeSerialFromItem: (productId, serial) => {
        const items = get().items;
        const existing = items.find((i) => i.product.id === productId);
        if (!existing) return;
        const serials = (existing.serials || []).filter((s) => s !== serial);
        if (serials.length === 0) {
          set({ items: items.filter((i) => i.product.id !== productId) });
        } else {
          set({
            items: items.map((i) =>
              i.product.id === productId
                ? { ...i, serials, quantity: serials.length,
                    total: serials.length * i.unitPrice * (1 - i.discount / 100) * (1 + i.tax / 100) }
                : i
            ),
          });
        }
      },

      removeItem: (productId) =>
        set({ items: get().items.filter((i) => i.product.id !== productId) }),

      updateItemQuantity: (productId, quantity) =>
        set({
          items: get().items.map((i) =>
            i.product.id === productId
              ? {
                  ...i,
                  quantity,
                  total: quantity * i.unitPrice * (1 - i.discount / 100) * (1 + i.tax / 100),
                }
              : i
          ),
        }),

      updateItemPrice: (productId, price) =>
        set({
          items: get().items.map((i) =>
            i.product.id === productId
              ? {
                  ...i,
                  unitPrice: price,
                  total: i.quantity * price * (1 - i.discount / 100) * (1 + i.tax / 100),
                }
              : i
          ),
        }),

      clearCart: () =>
        set({
          items: [],
          customerId: null,
          customer: null,
          discountPercent: 0,
          discountReason: null,
          notes: null,
          sourceQuoteId: null,
        }),

      setCustomer: (customer) =>
        set({ customer, customerId: customer?.id ?? null }),

      setDiscount: (percent, reason) =>
        set({ discountPercent: percent, discountReason: reason }),

      setNotes: (notes) => set({ notes }),

      setSourceQuoteId: (quoteId) => set({ sourceQuoteId: quoteId }),

      getSubtotal: () =>
        get().items.reduce(
          (sum, i) => sum + i.quantity * i.unitPrice * (1 - i.discount / 100),
          0
        ),

      getTax: () =>
        get().items.reduce(
          (sum, i) =>
            sum + i.quantity * i.unitPrice * (1 - i.discount / 100) * (i.tax / 100),
          0
        ),

      getTotal: () => {
        const sub = get().getSubtotal();
        const tax = get().getTax();
        const disc = sub * (get().discountPercent / 100);
        return sub + tax - disc;
      },

      getItemCount: () =>
        get().items.reduce((sum, i) => sum + i.quantity, 0),
    }),
    {
      name: 'erp-cart',
      storage: createJSONStorage(() => sessionStorage),
    }
  )
);

// ─── Notification Store ───────────────────────────────────────────────────────

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  addNotification: (notification: Notification) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  setNotifications: (notifications: Notification[]) => void;
  clearNotifications: () => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  addNotification: (notification) =>
    set({
      notifications: [notification, ...get().notifications],
      unreadCount: get().unreadCount + 1,
    }),
  markAsRead: (id) =>
    set({
      notifications: get().notifications.map((n) =>
        n.id === id ? { ...n, isRead: true, readAt: new Date() } : n
      ),
      unreadCount: Math.max(0, get().unreadCount - 1),
    }),
  markAllAsRead: () =>
    set({
      notifications: get().notifications.map((n) => ({
        ...n,
        isRead: true,
        readAt: new Date(),
      })),
      unreadCount: 0,
    }),
  setNotifications: (notifications) =>
    set({
      notifications,
      unreadCount: notifications.filter((n) => !n.isRead).length,
    }),
  clearNotifications: () => set({ notifications: [], unreadCount: 0 }),
}));

// ─── UI Store ─────────────────────────────────────────────────────────────────

interface UIState {
  sidebarCollapsed: boolean;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      sidebarOpen: true,
      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
    }),
    { name: 'erp-ui' }
  )
);
