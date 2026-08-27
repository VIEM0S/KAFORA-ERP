export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      alerts: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          is_resolved: boolean
          message: string | null
          reference: string | null
          reference_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: Database["public"]["Enums"]["alert_severity"]
          target_role: Database["public"]["Enums"]["user_role"] | null
          target_user_id: string | null
          tenant_id: string
          title: string
          type: Database["public"]["Enums"]["alert_type"]
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          is_resolved?: boolean
          message?: string | null
          reference?: string | null
          reference_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["alert_severity"]
          target_role?: Database["public"]["Enums"]["user_role"] | null
          target_user_id?: string | null
          tenant_id: string
          title: string
          type: Database["public"]["Enums"]["alert_type"]
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          is_resolved?: boolean
          message?: string | null
          reference?: string | null
          reference_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["alert_severity"]
          target_role?: Database["public"]["Enums"]["user_role"] | null
          target_user_id?: string | null
          tenant_id?: string
          title?: string
          type?: Database["public"]["Enums"]["alert_type"]
        }
        Relationships: [
          {
            foreignKeyName: "alerts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          details: string | null
          entity: string | null
          entity_id: string | null
          id: string
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: string | null
          entity?: string | null
          entity_id?: string | null
          id?: string
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: string | null
          entity?: string | null
          entity_id?: string | null
          id?: string
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_registers: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          store_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          store_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          store_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_registers_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_registers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_sessions: {
        Row: {
          acompte_total: number | null
          cash_refund_total: number | null
          cash_sales_total: number | null
          closed_at: string | null
          closed_by: string | null
          closed_by_name: string | null
          closing_balance: number | null
          created_at: string
          credit_repayment_total: number | null
          difference: number | null
          expected_balance: number | null
          id: string
          notes: string | null
          opened_at: string
          opened_by: string | null
          opened_by_name: string | null
          opening_balance: number
          register_id: string | null
          sales_count: number | null
          sales_total: number | null
          status: string
          store_id: string | null
          tenant_id: string
          variance_reason: string | null
        }
        Insert: {
          acompte_total?: number | null
          cash_refund_total?: number | null
          cash_sales_total?: number | null
          closed_at?: string | null
          closed_by?: string | null
          closed_by_name?: string | null
          closing_balance?: number | null
          created_at?: string
          credit_repayment_total?: number | null
          difference?: number | null
          expected_balance?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          opened_by?: string | null
          opened_by_name?: string | null
          opening_balance?: number
          register_id?: string | null
          sales_count?: number | null
          sales_total?: number | null
          status?: string
          store_id?: string | null
          tenant_id: string
          variance_reason?: string | null
        }
        Update: {
          acompte_total?: number | null
          cash_refund_total?: number | null
          cash_sales_total?: number | null
          closed_at?: string | null
          closed_by?: string | null
          closed_by_name?: string | null
          closing_balance?: number | null
          created_at?: string
          credit_repayment_total?: number | null
          difference?: number | null
          expected_balance?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          opened_by?: string | null
          opened_by_name?: string | null
          opening_balance?: number
          register_id?: string | null
          sales_count?: number | null
          sales_total?: number | null
          status?: string
          store_id?: string | null
          tenant_id?: string
          variance_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_sessions_register_id_fkey"
            columns: ["register_id"]
            isOneToOne: false
            referencedRelation: "cash_registers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_sessions_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          parent_id: string | null
          slug: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          parent_id?: string | null
          slug: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          parent_id?: string | null
          slug?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_payments: {
        Row: {
          amount: number
          created_at: string
          credit_id: string
          id: string
          notes: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          reference: string | null
          remaining_after: number | null
          store_id: string | null
          tenant_id: string
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          credit_id: string
          id?: string
          notes?: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          reference?: string | null
          remaining_after?: number | null
          store_id?: string | null
          tenant_id: string
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          credit_id?: string
          id?: string
          notes?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          reference?: string | null
          remaining_after?: number | null
          store_id?: string | null
          tenant_id?: string
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_payments_credit_id_fkey"
            columns: ["credit_id"]
            isOneToOne: false
            referencedRelation: "credits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_payments_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      credits: {
        Row: {
          cancellation_reason: string | null
          created_at: string
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          due_date: string | null
          id: string
          notes: string | null
          paid_amount: number
          penalty_amount: number | null
          penalty_rate: number | null
          reference: string | null
          remaining_amount: number
          sale_id: string | null
          status: Database["public"]["Enums"]["credit_status"]
          tenant_id: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          cancellation_reason?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          paid_amount?: number
          penalty_amount?: number | null
          penalty_rate?: number | null
          reference?: string | null
          remaining_amount: number
          sale_id?: string | null
          status?: Database["public"]["Enums"]["credit_status"]
          tenant_id: string
          total_amount: number
          updated_at?: string
        }
        Update: {
          cancellation_reason?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          paid_amount?: number
          penalty_amount?: number | null
          penalty_rate?: number | null
          reference?: string | null
          remaining_amount?: number
          sale_id?: string | null
          status?: Database["public"]["Enums"]["credit_status"]
          tenant_id?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "credits_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credits_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credits_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          city: string | null
          code: string | null
          company_name: string | null
          created_at: string
          credit_limit: number
          credit_used: number
          customer_type: Database["public"]["Enums"]["customer_type"]
          email: string | null
          first_name: string | null
          id: string
          is_active: boolean
          last_name: string | null
          notes: string | null
          phone: string | null
          search_name: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          code?: string | null
          company_name?: string | null
          created_at?: string
          credit_limit?: number
          credit_used?: number
          customer_type?: Database["public"]["Enums"]["customer_type"]
          email?: string | null
          first_name?: string | null
          id?: string
          is_active?: boolean
          last_name?: string | null
          notes?: string | null
          phone?: string | null
          search_name?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          code?: string | null
          company_name?: string | null
          created_at?: string
          credit_limit?: number
          credit_used?: number
          customer_type?: Database["public"]["Enums"]["customer_type"]
          email?: string | null
          first_name?: string | null
          id?: string
          is_active?: boolean
          last_name?: string | null
          notes?: string | null
          phone?: string | null
          search_name?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_stats: {
        Row: {
          by_payment: Json | null
          by_store: Json | null
          computed_at: string
          cost: number
          cost_by_category: Json | null
          cost_incomplete: boolean
          date: string
          id: string
          item_count: number
          margin: number
          margin_by_category: Json | null
          revenue: number
          revenue_by_category: Json | null
          sale_count: number
          tenant_id: string
          top_products: Json | null
          unique_customers: number
        }
        Insert: {
          by_payment?: Json | null
          by_store?: Json | null
          computed_at?: string
          cost?: number
          cost_by_category?: Json | null
          cost_incomplete?: boolean
          date: string
          id?: string
          item_count?: number
          margin?: number
          margin_by_category?: Json | null
          revenue?: number
          revenue_by_category?: Json | null
          sale_count?: number
          tenant_id: string
          top_products?: Json | null
          unique_customers?: number
        }
        Update: {
          by_payment?: Json | null
          by_store?: Json | null
          computed_at?: string
          cost?: number
          cost_by_category?: Json | null
          cost_incomplete?: boolean
          date?: string
          id?: string
          item_count?: number
          margin?: number
          margin_by_category?: Json | null
          revenue?: number
          revenue_by_category?: Json | null
          sale_count?: number
          tenant_id?: string
          top_products?: Json | null
          unique_customers?: number
        }
        Relationships: [
          {
            foreignKeyName: "daily_stats_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      error_logs: {
        Row: {
          context: Json | null
          created_at: string
          id: string
          message: string | null
          stack: string | null
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          context?: Json | null
          created_at?: string
          id?: string
          message?: string | null
          stack?: string | null
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          context?: Json | null
          created_at?: string
          id?: string
          message?: string | null
          stack?: string | null
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "error_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory: {
        Row: {
          id: string
          last_stock_check: string | null
          max_quantity: number | null
          min_quantity: number | null
          product_id: string
          quantity: number
          reorder_point: number | null
          store_id: string
          tenant_id: string
        }
        Insert: {
          id?: string
          last_stock_check?: string | null
          max_quantity?: number | null
          min_quantity?: number | null
          product_id: string
          quantity?: number
          reorder_point?: number | null
          store_id: string
          tenant_id: string
        }
        Update: {
          id?: string
          last_stock_check?: string | null
          max_quantity?: number | null
          min_quantity?: number | null
          product_id?: string
          quantity?: number
          reorder_point?: number | null
          store_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          new_quantity: number | null
          previous_quantity: number | null
          product_id: string
          product_name: string
          purchase_order_id: string | null
          quantity: number
          reason: string | null
          sale_id: string | null
          store_id: string | null
          tenant_id: string
          transfer_id: string | null
          type: Database["public"]["Enums"]["inventory_movement_type"]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          new_quantity?: number | null
          previous_quantity?: number | null
          product_id: string
          product_name: string
          purchase_order_id?: string | null
          quantity: number
          reason?: string | null
          sale_id?: string | null
          store_id?: string | null
          tenant_id: string
          transfer_id?: string | null
          type: Database["public"]["Enums"]["inventory_movement_type"]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          new_quantity?: number | null
          previous_quantity?: number | null
          product_id?: string
          product_name?: string
          purchase_order_id?: string | null
          quantity?: number
          reason?: string | null
          sale_id?: string | null
          store_id?: string | null
          tenant_id?: string
          transfer_id?: string | null
          type?: Database["public"]["Enums"]["inventory_movement_type"]
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          created_at: string
          created_by: string | null
          data: Json | null
          id: string
          reference: string
          sale_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data?: Json | null
          id?: string
          reference: string
          sale_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data?: Json | null
          id?: string
          reference?: string
          sale_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          id: string
          is_read: boolean
          message: string | null
          read_at: string | null
          reference: string | null
          reference_id: string | null
          tenant_id: string
          title: string
          type: string | null
          user_id: string
        }
        Insert: {
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string | null
          read_at?: string | null
          reference?: string | null
          reference_id?: string | null
          tenant_id: string
          title: string
          type?: string | null
          user_id: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string | null
          read_at?: string | null
          reference?: string | null
          reference_id?: string | null
          tenant_id?: string
          title?: string
          type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          mobile_provider: string | null
          reference: string | null
          sale_id: string
          tenant_id: string
        }
        Insert: {
          amount: number
          id?: string
          method: Database["public"]["Enums"]["payment_method"]
          mobile_provider?: string | null
          reference?: string | null
          sale_id: string
          tenant_id: string
        }
        Update: {
          amount?: number
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          mobile_provider?: string | null
          reference?: string | null
          sale_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          alert_threshold: number | null
          barcode: string | null
          category_id: string | null
          created_at: string
          description: string | null
          id: string
          image_data: string | null
          is_active: boolean
          name: string
          name_lower: string | null
          purchase_price: number | null
          selling_price: number
          sku: string | null
          tax_rate: number
          tenant_id: string
          track_inventory: boolean
          unit: string | null
          updated_at: string
        }
        Insert: {
          alert_threshold?: number | null
          barcode?: string | null
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_data?: string | null
          is_active?: boolean
          name: string
          name_lower?: string | null
          purchase_price?: number | null
          selling_price: number
          sku?: string | null
          tax_rate?: number
          tenant_id: string
          track_inventory?: boolean
          unit?: string | null
          updated_at?: string
        }
        Update: {
          alert_threshold?: number | null
          barcode?: string | null
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_data?: string | null
          is_active?: boolean
          name?: string
          name_lower?: string | null
          purchase_price?: number | null
          selling_price?: number
          sku?: string | null
          tax_rate?: number
          tenant_id?: string
          track_inventory?: boolean
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_counters: {
        Row: {
          tenant_id: string
          value: number
        }
        Insert: {
          tenant_id: string
          value?: number
        }
        Update: {
          tenant_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_counters_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_items: {
        Row: {
          id: string
          product_id: string | null
          product_name: string
          product_sku: string | null
          purchase_order_id: string
          quantity_ordered: number
          quantity_received: number
          total: number
          unit_cost: number
        }
        Insert: {
          id?: string
          product_id?: string | null
          product_name: string
          product_sku?: string | null
          purchase_order_id: string
          quantity_ordered: number
          quantity_received?: number
          total: number
          unit_cost: number
        }
        Update: {
          id?: string
          product_id?: string | null
          product_name?: string
          product_sku?: string | null
          purchase_order_id?: string
          quantity_ordered?: number
          quantity_received?: number
          total?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          created_at: string
          created_by: string | null
          created_by_name: string | null
          expected_date: string | null
          id: string
          notes: string | null
          received_at: string | null
          reference: string
          status: Database["public"]["Enums"]["purchase_order_status"]
          store_id: string | null
          subtotal: number
          supplier_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          expected_date?: string | null
          id?: string
          notes?: string | null
          received_at?: string | null
          reference: string
          status?: Database["public"]["Enums"]["purchase_order_status"]
          store_id?: string | null
          subtotal?: number
          supplier_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          expected_date?: string | null
          id?: string
          notes?: string | null
          received_at?: string | null
          reference?: string
          status?: Database["public"]["Enums"]["purchase_order_status"]
          store_id?: string | null
          subtotal?: number
          supplier_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_items: {
        Row: {
          discount_percent: number
          id: string
          product_id: string | null
          product_name: string
          product_sku: string | null
          quantity: number
          quote_id: string
          tax_rate: number
          tenant_id: string
          total: number
          unit_price: number
        }
        Insert: {
          discount_percent?: number
          id?: string
          product_id?: string | null
          product_name: string
          product_sku?: string | null
          quantity: number
          quote_id: string
          tax_rate?: number
          tenant_id: string
          total: number
          unit_price: number
        }
        Update: {
          discount_percent?: number
          id?: string
          product_id?: string | null
          product_name?: string
          product_sku?: string | null
          quantity?: number
          quote_id?: string
          tax_rate?: number
          tenant_id?: string
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_items_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          converted_sale_id: string | null
          created_at: string
          customer_id: string | null
          customer_name: string | null
          discount_amount: number
          id: string
          notes: string | null
          reference: string | null
          status: Database["public"]["Enums"]["quote_status"]
          subtotal: number
          tax_amount: number
          tenant_id: string
          terms: string | null
          total: number
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          converted_sale_id?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          discount_amount?: number
          id?: string
          notes?: string | null
          reference?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          subtotal?: number
          tax_amount?: number
          tenant_id: string
          terms?: string | null
          total?: number
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          converted_sale_id?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          discount_amount?: number
          id?: string
          notes?: string | null
          reference?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          subtotal?: number
          tax_amount?: number
          tenant_id?: string
          terms?: string | null
          total?: number
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_converted_sale_id_fkey"
            columns: ["converted_sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          count: number
          key: string
          updated_at: string
          window_start_ms: number
        }
        Insert: {
          count?: number
          key: string
          updated_at?: string
          window_start_ms: number
        }
        Update: {
          count?: number
          key?: string
          updated_at?: string
          window_start_ms?: number
        }
        Relationships: []
      }
      referrals: {
        Row: {
          created_at: string
          id: string
          referred_company_name: string | null
          referred_tenant_id: string
          referrer_tenant_id: string
          rewarded_at: string | null
          status: Database["public"]["Enums"]["referral_status"]
        }
        Insert: {
          created_at?: string
          id?: string
          referred_company_name?: string | null
          referred_tenant_id: string
          referrer_tenant_id: string
          rewarded_at?: string | null
          status?: Database["public"]["Enums"]["referral_status"]
        }
        Update: {
          created_at?: string
          id?: string
          referred_company_name?: string | null
          referred_tenant_id?: string
          referrer_tenant_id?: string
          rewarded_at?: string | null
          status?: Database["public"]["Enums"]["referral_status"]
        }
        Relationships: [
          {
            foreignKeyName: "referrals_referred_tenant_id_fkey"
            columns: ["referred_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referrer_tenant_id_fkey"
            columns: ["referrer_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_cost_summary: {
        Row: {
          cost_by_category: Json | null
          cost_incomplete: boolean
          cost_total: number
          created_at: string
          id: string
          lines_without_cost: number
          margin: number
          sale_id: string
          store_id: string | null
          tenant_id: string
        }
        Insert: {
          cost_by_category?: Json | null
          cost_incomplete?: boolean
          cost_total?: number
          created_at?: string
          id?: string
          lines_without_cost?: number
          margin?: number
          sale_id: string
          store_id?: string | null
          tenant_id: string
        }
        Update: {
          cost_by_category?: Json | null
          cost_incomplete?: boolean
          cost_total?: number
          created_at?: string
          id?: string
          lines_without_cost?: number
          margin?: number
          sale_id?: string
          store_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_cost_summary_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: true
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_cost_summary_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_cost_summary_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_counters: {
        Row: {
          fiscal_year: number
          tenant_id: string
          value: number
        }
        Insert: {
          fiscal_year: number
          tenant_id: string
          value?: number
        }
        Update: {
          fiscal_year?: number
          tenant_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_counters_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          category_id: string | null
          created_at: string
          discount_percent: number
          id: string
          product_id: string | null
          product_name: string
          product_sku: string | null
          purchase_price: number | null
          quantity: number
          returned_quantity: number
          sale_id: string
          tax_rate: number
          tenant_id: string
          total: number
          unit_price: number
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          discount_percent?: number
          id?: string
          product_id?: string | null
          product_name: string
          product_sku?: string | null
          purchase_price?: number | null
          quantity: number
          returned_quantity?: number
          sale_id: string
          tax_rate?: number
          tenant_id: string
          total: number
          unit_price: number
        }
        Update: {
          category_id?: string | null
          created_at?: string
          discount_percent?: number
          id?: string
          product_id?: string | null
          product_name?: string
          product_sku?: string | null
          purchase_price?: number | null
          quantity?: number
          returned_quantity?: number
          sale_id?: string
          tax_rate?: number
          tenant_id?: string
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_return_items: {
        Row: {
          id: string
          product_id: string | null
          product_name: string
          quantity: number
          restocked: boolean
          sale_return_id: string
          total: number
          unit_price: number
        }
        Insert: {
          id?: string
          product_id?: string | null
          product_name: string
          quantity: number
          restocked?: boolean
          sale_return_id: string
          total: number
          unit_price: number
        }
        Update: {
          id?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
          restocked?: boolean
          sale_return_id?: string
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_return_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_return_items_sale_return_id_fkey"
            columns: ["sale_return_id"]
            isOneToOne: false
            referencedRelation: "sale_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_returns: {
        Row: {
          cash_refund: number
          created_at: string
          credit_reduction: number
          customer_id: string | null
          id: string
          processed_by: string | null
          processed_by_name: string | null
          reason: string | null
          refund_amount: number
          refund_method: Database["public"]["Enums"]["refund_method"]
          sale_id: string
          sale_reference: string
          status: Database["public"]["Enums"]["return_status"]
          store_id: string | null
          tenant_id: string
        }
        Insert: {
          cash_refund?: number
          created_at?: string
          credit_reduction?: number
          customer_id?: string | null
          id?: string
          processed_by?: string | null
          processed_by_name?: string | null
          reason?: string | null
          refund_amount?: number
          refund_method: Database["public"]["Enums"]["refund_method"]
          sale_id: string
          sale_reference: string
          status?: Database["public"]["Enums"]["return_status"]
          store_id?: string | null
          tenant_id: string
        }
        Update: {
          cash_refund?: number
          created_at?: string
          credit_reduction?: number
          customer_id?: string | null
          id?: string
          processed_by?: string | null
          processed_by_name?: string | null
          reason?: string | null
          refund_amount?: number
          refund_method?: Database["public"]["Enums"]["refund_method"]
          sale_id?: string
          sale_reference?: string
          status?: Database["public"]["Enums"]["return_status"]
          store_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_returns_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_returns_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_returns_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_returns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cashier_id: string | null
          change_given: number
          created_at: string
          credit_conflict: boolean
          customer_id: string | null
          customer_name: string | null
          discount_amount: number
          discount_reason: string | null
          id: string
          notes: string | null
          offline_sync_id: string | null
          paid_amount: number
          payment_method: Database["public"]["Enums"]["payment_method"]
          reference: string
          status: Database["public"]["Enums"]["sale_status"]
          stock_conflict: boolean
          store_id: string | null
          subtotal: number
          tax_amount: number
          tenant_id: string
          total: number
          updated_at: string
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cashier_id?: string | null
          change_given?: number
          created_at?: string
          credit_conflict?: boolean
          customer_id?: string | null
          customer_name?: string | null
          discount_amount?: number
          discount_reason?: string | null
          id?: string
          notes?: string | null
          offline_sync_id?: string | null
          paid_amount?: number
          payment_method: Database["public"]["Enums"]["payment_method"]
          reference: string
          status?: Database["public"]["Enums"]["sale_status"]
          stock_conflict?: boolean
          store_id?: string | null
          subtotal?: number
          tax_amount?: number
          tenant_id: string
          total?: number
          updated_at?: string
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cashier_id?: string | null
          change_given?: number
          created_at?: string
          credit_conflict?: boolean
          customer_id?: string | null
          customer_name?: string | null
          discount_amount?: number
          discount_reason?: string | null
          id?: string
          notes?: string | null
          offline_sync_id?: string | null
          paid_amount?: number
          payment_method?: Database["public"]["Enums"]["payment_method"]
          reference?: string
          status?: Database["public"]["Enums"]["sale_status"]
          stock_conflict?: boolean
          store_id?: string | null
          subtotal?: number
          tax_amount?: number
          tenant_id?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          address: string | null
          city: string | null
          code: string
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          is_warehouse: boolean
          name: string
          phone: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          code: string
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          is_warehouse?: boolean
          name: string
          phone?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          code?: string
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          is_warehouse?: boolean
          name?: string
          phone?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stores_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          method: string | null
          months: number
          note: string | null
          period_end: string
          period_start: string
          plan: Database["public"]["Enums"]["subscription_plan"]
          recorded_by: string | null
          tenant_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          method?: string | null
          months: number
          note?: string | null
          period_end: string
          period_start: string
          plan: Database["public"]["Enums"]["subscription_plan"]
          recorded_by?: string | null
          tenant_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          method?: string | null
          months?: number
          note?: string | null
          period_end?: string
          period_start?: string
          plan?: Database["public"]["Enums"]["subscription_plan"]
          recorded_by?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          limits: Json | null
          plan: Database["public"]["Enums"]["subscription_plan"]
          status: Database["public"]["Enums"]["subscription_status"]
          tenant_id: string
          trial_ends_at: string | null
          updated_at: string
          write_blocked_at: string | null
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          limits?: Json | null
          plan?: Database["public"]["Enums"]["subscription_plan"]
          status?: Database["public"]["Enums"]["subscription_status"]
          tenant_id: string
          trial_ends_at?: string | null
          updated_at?: string
          write_blocked_at?: string | null
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          limits?: Json | null
          plan?: Database["public"]["Enums"]["subscription_plan"]
          status?: Database["public"]["Enums"]["subscription_status"]
          tenant_id?: string
          trial_ends_at?: string | null
          updated_at?: string
          write_blocked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      super_admin_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          performed_by: string | null
          reason: string | null
          target_email: string | null
          tenant_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          performed_by?: string | null
          reason?: string | null
          target_email?: string | null
          tenant_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          performed_by?: string | null
          reason?: string | null
          target_email?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "super_admin_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      super_admins: {
        Row: {
          created_at: string
          email: string
          first_name: string | null
          id: string
          is_active: boolean
          last_name: string | null
        }
        Insert: {
          created_at?: string
          email: string
          first_name?: string | null
          id: string
          is_active?: boolean
          last_name?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          first_name?: string | null
          id?: string
          is_active?: boolean
          last_name?: string | null
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          address: string | null
          city: string | null
          code: string | null
          contact_person: string | null
          country: string | null
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          payment_terms: number | null
          phone: string | null
          tax_id: string | null
          tenant_id: string
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          code?: string | null
          contact_person?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          payment_terms?: number | null
          phone?: string | null
          tax_id?: string | null
          tenant_id: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          code?: string | null
          contact_person?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          payment_terms?: number | null
          phone?: string | null
          tax_id?: string | null
          tenant_id?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_dedup: {
        Row: {
          created_at: string
          offline_sync_id: string
          reference: string | null
          sale_id: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          offline_sync_id: string
          reference?: string | null
          sale_id?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          offline_sync_id?: string
          reference?: string | null
          sale_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_dedup_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_dedup_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          address: string | null
          city: string | null
          country: string
          created_at: string
          currency: string
          email: string
          id: string
          is_active: boolean
          logo: string | null
          name: string
          nif: string | null
          phone: string | null
          rccm: string | null
          referral_code: string | null
          referred_by_tenant_id: string | null
          slug: string
          suspended_at: string | null
          suspension_reason: string | null
          terms_acceptance: Json | null
          timezone: string
          transfer_settings: Json | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          country?: string
          created_at?: string
          currency?: string
          email: string
          id?: string
          is_active?: boolean
          logo?: string | null
          name: string
          nif?: string | null
          phone?: string | null
          rccm?: string | null
          referral_code?: string | null
          referred_by_tenant_id?: string | null
          slug: string
          suspended_at?: string | null
          suspension_reason?: string | null
          terms_acceptance?: Json | null
          timezone?: string
          transfer_settings?: Json | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          country?: string
          created_at?: string
          currency?: string
          email?: string
          id?: string
          is_active?: boolean
          logo?: string | null
          name?: string
          nif?: string | null
          phone?: string | null
          rccm?: string | null
          referral_code?: string | null
          referred_by_tenant_id?: string | null
          slug?: string
          suspended_at?: string | null
          suspension_reason?: string | null
          terms_acceptance?: Json | null
          timezone?: string
          transfer_settings?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenants_referred_by_tenant_id_fkey"
            columns: ["referred_by_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      transfer_lines: {
        Row: {
          id: string
          product_id: string | null
          product_name: string
          product_sku: string | null
          quantity: number
          transfer_id: string
        }
        Insert: {
          id?: string
          product_id?: string | null
          product_name: string
          product_sku?: string | null
          quantity: number
          transfer_id: string
        }
        Update: {
          id?: string
          product_id?: string | null
          product_name?: string
          product_sku?: string | null
          quantity?: number
          transfer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfer_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_lines_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      transfers: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          from_store_id: string | null
          id: string
          note: string | null
          received_at: string | null
          received_by: string | null
          reference: string
          rejection_reason: string | null
          requested_by: string | null
          shipped_at: string | null
          shipped_by: string | null
          status: Database["public"]["Enums"]["transfer_status"]
          tenant_id: string
          to_store_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          from_store_id?: string | null
          id?: string
          note?: string | null
          received_at?: string | null
          received_by?: string | null
          reference: string
          rejection_reason?: string | null
          requested_by?: string | null
          shipped_at?: string | null
          shipped_by?: string | null
          status?: Database["public"]["Enums"]["transfer_status"]
          tenant_id: string
          to_store_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          from_store_id?: string | null
          id?: string
          note?: string | null
          received_at?: string | null
          received_by?: string | null
          reference?: string
          rejection_reason?: string | null
          requested_by?: string | null
          shipped_at?: string | null
          shipped_by?: string | null
          status?: Database["public"]["Enums"]["transfer_status"]
          tenant_id?: string
          to_store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transfers_from_store_id_fkey"
            columns: ["from_store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_to_store_id_fkey"
            columns: ["to_store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      user_deletion_requests: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          justification: string | null
          requested_by: string | null
          requested_by_name: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          resolved_by_name: string | null
          status: Database["public"]["Enums"]["deletion_request_status"]
          target_user_id: string
          target_user_name: string | null
          target_user_role: Database["public"]["Enums"]["user_role"] | null
          tenant_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          justification?: string | null
          requested_by?: string | null
          requested_by_name?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_by_name?: string | null
          status?: Database["public"]["Enums"]["deletion_request_status"]
          target_user_id: string
          target_user_name?: string | null
          target_user_role?: Database["public"]["Enums"]["user_role"] | null
          tenant_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          justification?: string | null
          requested_by?: string | null
          requested_by_name?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_by_name?: string | null
          status?: Database["public"]["Enums"]["deletion_request_status"]
          target_user_id?: string
          target_user_name?: string | null
          target_user_role?: Database["public"]["Enums"]["user_role"] | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_deletion_requests_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_deletion_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          email: string
          email_verified: boolean
          first_name: string
          id: string
          is_active: boolean
          last_login_at: string | null
          last_name: string
          mfa_enabled: boolean
          phone: string | null
          restored_at: string | null
          restored_by: string | null
          role: Database["public"]["Enums"]["user_role"]
          store_ids: string[] | null
          tenant_id: string | null
          updated_at: string
          working_hours: Json | null
        }
        Insert: {
          avatar?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          email: string
          email_verified?: boolean
          first_name?: string
          id: string
          is_active?: boolean
          last_login_at?: string | null
          last_name?: string
          mfa_enabled?: boolean
          phone?: string | null
          restored_at?: string | null
          restored_by?: string | null
          role: Database["public"]["Enums"]["user_role"]
          store_ids?: string[] | null
          tenant_id?: string | null
          updated_at?: string
          working_hours?: Json | null
        }
        Update: {
          avatar?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          email?: string
          email_verified?: boolean
          first_name?: string
          id?: string
          is_active?: boolean
          last_login_at?: string | null
          last_name?: string
          mfa_enabled?: boolean
          phone?: string | null
          restored_at?: string | null
          restored_by?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          store_ids?: string[] | null
          tenant_id?: string | null
          updated_at?: string
          working_hours?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_extend_subscription: {
        Args: {
          p_amount: number
          p_limits_by_plan: Json
          p_method: string
          p_months: number
          p_note: string
          p_performed_by: string
          p_plan: Database["public"]["Enums"]["subscription_plan"]
          p_referrer_bonus_days: number
          p_tenant_id: string
        }
        Returns: Json
      }
      auth_role: { Args: never; Returns: string }
      auth_store_ids: { Args: never; Returns: string[] }
      auth_tenant_id: { Args: never; Returns: string }
      belongs_to_tenant: { Args: { tid: string }; Returns: boolean }
      can_access_store: { Args: { sid: string }; Returns: boolean }
      can_write: { Args: { tid: string }; Returns: boolean }
      cancel_sale: {
        Args: {
          p_caller_id: string
          p_motif: string
          p_sale_id: string
          p_tenant_id: string
        }
        Returns: Json
      }
      check_rate_limit: {
        Args: {
          p_key: string
          p_max_attempts: number
          p_window_seconds: number
        }
        Returns: Json
      }
      close_cash_register: {
        Args: {
          p_caller_id: string
          p_caller_name: string
          p_counted_amount: number
          p_notes: string
          p_register_id: string
          p_store_id: string
          p_tenant_id: string
        }
        Returns: Json
      }
      create_purchase_order: {
        Args: {
          p_created_by: string
          p_created_by_name: string
          p_expected_date: string
          p_items: Json
          p_notes: string
          p_status: Database["public"]["Enums"]["purchase_order_status"]
          p_store_id: string
          p_supplier_id: string
          p_tenant_id: string
        }
        Returns: Json
      }
      create_sale_return: {
        Args: {
          p_caller_id: string
          p_items: Json
          p_processed_by_name: string
          p_reason: string
          p_refund_method: Database["public"]["Enums"]["refund_method"]
          p_sale_id: string
          p_tenant_id: string
        }
        Returns: Json
      }
      decide_transfer: {
        Args: {
          p_action: string
          p_caller_id: string
          p_reason: string
          p_tenant_id: string
          p_transfer_id: string
        }
        Returns: Json
      }
      is_manager: { Args: never; Returns: boolean }
      is_owner: { Args: never; Returns: boolean }
      is_owner_or_admin: { Args: never; Returns: boolean }
      is_regional_manager: { Args: never; Returns: boolean }
      open_cash_register: {
        Args: {
          p_caller_id: string
          p_caller_name: string
          p_opening_balance: number
          p_register_id: string
          p_store_id: string
          p_tenant_id: string
        }
        Returns: Json
      }
      pos_checkout: {
        Args: {
          p_acompte: number
          p_amount_received: number
          p_cashier_id: string
          p_change: number
          p_customer_id: string
          p_customer_name: string
          p_customer_phone: string
          p_discount_amount: number
          p_discount_percent: number
          p_item_count: number
          p_lines: Json
          p_offline_sync_id: string
          p_payment_method: Database["public"]["Enums"]["payment_method"]
          p_quote_id: string
          p_requires_credit_check: boolean
          p_solde_credit: number
          p_store_id: string
          p_subtotal: number
          p_tax_total: number
          p_tenant_id: string
          p_total: number
          p_user_name: string
        }
        Returns: Json
      }
      receive_purchase_order: {
        Args: {
          p_caller_id: string
          p_lines: Json
          p_po_id: string
          p_tenant_id: string
        }
        Returns: Json
      }
      receive_transfer: {
        Args: {
          p_caller_id: string
          p_tenant_id: string
          p_transfer_id: string
        }
        Returns: Json
      }
      register_tenant: {
        Args: {
          p_limits: Json
          p_own_referral_code: string
          p_owner_email: string
          p_owner_first_name: string
          p_owner_last_name: string
          p_owner_phone: string
          p_owner_user_id: string
          p_plan: Database["public"]["Enums"]["subscription_plan"]
          p_referred_by_tenant_id: string
          p_store_address: string
          p_store_city: string
          p_store_code: string
          p_store_name: string
          p_store_phone: string
          p_tenant_address: string
          p_tenant_city: string
          p_tenant_country: string
          p_tenant_currency: string
          p_tenant_email: string
          p_tenant_name: string
          p_tenant_nif: string
          p_tenant_phone: string
          p_tenant_rccm: string
          p_tenant_slug: string
          p_terms_acceptance: Json
          p_trial_end: string
        }
        Returns: Json
      }
      repay_credit: {
        Args: {
          p_amount: number
          p_credit_id: string
          p_store_id: string
          p_user_name: string
        }
        Returns: Json
      }
      set_tenant_status: {
        Args: {
          p_is_active: boolean
          p_performed_by: string
          p_reason: string
          p_tenant_id: string
        }
        Returns: Json
      }
      ship_transfer: {
        Args: {
          p_caller_id: string
          p_tenant_id: string
          p_transfer_id: string
        }
        Returns: Json
      }
      subscription_active: { Args: { tid: string }; Returns: boolean }
    }
    Enums: {
      alert_severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
      alert_type:
        | "LOW_STOCK"
        | "OUT_OF_STOCK"
        | "OVERDUE_CREDIT"
        | "LARGE_DISCOUNT"
        | "REFUND"
        | "CASH_VARIANCE"
        | "FAILED_PAYMENT"
        | "SUSPICIOUS_ACTIVITY"
        | "OFFLINE_SYNC_CONFLICT"
        | "USER_DELETION_REQUEST"
        | "USER_DELETION_RESOLVED"
      credit_status:
        | "PENDING"
        | "PARTIALLY_PAID"
        | "PAID"
        | "OVERDUE"
        | "CANCELLED"
        | "WRITTEN_OFF"
      customer_type: "INDIVIDUAL" | "BUSINESS" | "WALK_IN"
      deletion_request_status:
        | "PENDING"
        | "APPROVED"
        | "REJECTED"
        | "CANCELLED"
        | "COMPLETED"
      inventory_movement_type:
        | "SALE"
        | "PURCHASE"
        | "TRANSFER_OUT"
        | "TRANSFER_IN"
        | "ADJUSTMENT"
        | "RETURN"
        | "INITIAL"
        | "TRANSFER_CANCEL"
      notification_channel: "IN_APP" | "EMAIL" | "SMS" | "WHATSAPP" | "PUSH"
      payment_method:
        | "CASH"
        | "MOBILE_MONEY"
        | "BANK_TRANSFER"
        | "CREDIT"
        | "CARD"
        | "SPLIT"
      purchase_order_status:
        | "DRAFT"
        | "SENT"
        | "PARTIALLY_RECEIVED"
        | "RECEIVED"
        | "CANCELLED"
      quote_status: "PENDING" | "ACCEPTED" | "CONVERTED" | "REFUSED" | "EXPIRED"
      referral_status: "PENDING" | "REWARDED"
      refund_method: "CASH" | "STORE_CREDIT" | "ORIGINAL_PAYMENT_METHOD"
      return_status: "COMPLETED" | "CANCELLED"
      sale_status:
        | "DRAFT"
        | "PENDING"
        | "COMPLETED"
        | "CANCELLED"
        | "REFUNDED"
        | "PARTIALLY_REFUNDED"
      subscription_plan: "STARTER" | "BUSINESS" | "ENTERPRISE"
      subscription_status:
        | "TRIAL"
        | "ACTIVE"
        | "PAST_DUE"
        | "CANCELLED"
        | "EXPIRED"
      transfer_status:
        | "PENDING"
        | "APPROVED"
        | "SHIPPED"
        | "RECEIVED"
        | "REJECTED"
        | "CANCELLED"
      user_role:
        | "SUPER_ADMIN"
        | "OWNER"
        | "ADMIN"
        | "REGIONAL_MANAGER"
        | "MANAGER"
        | "CASHIER"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      alert_severity: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      alert_type: [
        "LOW_STOCK",
        "OUT_OF_STOCK",
        "OVERDUE_CREDIT",
        "LARGE_DISCOUNT",
        "REFUND",
        "CASH_VARIANCE",
        "FAILED_PAYMENT",
        "SUSPICIOUS_ACTIVITY",
        "OFFLINE_SYNC_CONFLICT",
        "USER_DELETION_REQUEST",
        "USER_DELETION_RESOLVED",
      ],
      credit_status: [
        "PENDING",
        "PARTIALLY_PAID",
        "PAID",
        "OVERDUE",
        "CANCELLED",
        "WRITTEN_OFF",
      ],
      customer_type: ["INDIVIDUAL", "BUSINESS", "WALK_IN"],
      deletion_request_status: [
        "PENDING",
        "APPROVED",
        "REJECTED",
        "CANCELLED",
        "COMPLETED",
      ],
      inventory_movement_type: [
        "SALE",
        "PURCHASE",
        "TRANSFER_OUT",
        "TRANSFER_IN",
        "ADJUSTMENT",
        "RETURN",
        "INITIAL",
        "TRANSFER_CANCEL",
      ],
      notification_channel: ["IN_APP", "EMAIL", "SMS", "WHATSAPP", "PUSH"],
      payment_method: [
        "CASH",
        "MOBILE_MONEY",
        "BANK_TRANSFER",
        "CREDIT",
        "CARD",
        "SPLIT",
      ],
      purchase_order_status: [
        "DRAFT",
        "SENT",
        "PARTIALLY_RECEIVED",
        "RECEIVED",
        "CANCELLED",
      ],
      quote_status: ["PENDING", "ACCEPTED", "CONVERTED", "REFUSED", "EXPIRED"],
      referral_status: ["PENDING", "REWARDED"],
      refund_method: ["CASH", "STORE_CREDIT", "ORIGINAL_PAYMENT_METHOD"],
      return_status: ["COMPLETED", "CANCELLED"],
      sale_status: [
        "DRAFT",
        "PENDING",
        "COMPLETED",
        "CANCELLED",
        "REFUNDED",
        "PARTIALLY_REFUNDED",
      ],
      subscription_plan: ["STARTER", "BUSINESS", "ENTERPRISE"],
      subscription_status: [
        "TRIAL",
        "ACTIVE",
        "PAST_DUE",
        "CANCELLED",
        "EXPIRED",
      ],
      transfer_status: [
        "PENDING",
        "APPROVED",
        "SHIPPED",
        "RECEIVED",
        "REJECTED",
        "CANCELLED",
      ],
      user_role: [
        "SUPER_ADMIN",
        "OWNER",
        "ADMIN",
        "REGIONAL_MANAGER",
        "MANAGER",
        "CASHIER",
      ],
    },
  },
} as const
