-- Initial schema: orders, messages, files, and the customer-service-workflow
-- extension tables (support cases, invoices, order status audit, print jobs).
--
-- Every non-obvious choice here is explained and cited in
-- ../../study/02-supabase-schema-design.md and
-- ../../study/06-customer-service-workflow-expansion.md — this file
-- implements those decisions, it doesn't re-derive them.
--
-- Portable to plain self-hosted Postgres (see ../../study/03-migration-to-self-hosted.md):
-- no Supabase-only functions/extensions are used. gen_random_uuid() is a
-- native Postgres 13+ function (https://www.postgresql.org/docs/current/functions-uuid.html).
-- RLS policies below are plain Postgres RLS and migrate as-is via
-- `supabase db dump`. The one Supabase-specific piece is the `service_role`
-- BYPASSRLS behavior the Node API relies on — on self-hosted Postgres this
-- needs an equivalent role grant (noted, not solved, in study/03).

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
create table orders (
    id uuid primary key default gen_random_uuid(),
    platform text not null,
    external_order_id text not null,
    tracking_number text,
    customer_name text,
    phone_number text,
    email text,
    status text not null default 'new',
    review_reason text,
    raw_payload jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint orders_platform_check
        check (platform in ('shopee', 'lazada', 'website', 'other')),
    constraint orders_status_check
        check (status in ('new', 'in_progress', 'human_review', 'completed',
                           'cancelled', 'returned')),
    constraint orders_review_reason_check
        check (review_reason is null or review_reason in (
            'no_conversation_found', 'no_attachment_found',
            'low_confidence_file_match', 'multiple_conversations_found',
            'manual_communication_required'
        )),
    constraint orders_platform_external_id_unique
        unique (platform, external_order_id)
);

create index orders_status_idx on orders (status);
create index orders_phone_number_idx on orders (phone_number);
create index orders_raw_payload_gin_idx
    on orders using gin (raw_payload jsonb_path_ops);

-- ---------------------------------------------------------------------------
-- order_items
-- ---------------------------------------------------------------------------
create table order_items (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references orders (id) on delete cascade,
    product_name text,
    sku text,
    variation text,
    quantity integer
);

create index order_items_order_id_idx on order_items (order_id);

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
create table messages (
    id uuid primary key default gen_random_uuid(),
    order_id uuid references orders (id) on delete set null,
    platform text not null,
    conversation_id text,
    external_message_id text,
    sender text,
    receiver text,
    direction text,
    content text,
    message_time timestamptz,
    raw_payload jsonb,
    created_at timestamptz not null default now(),

    constraint messages_platform_check
        check (platform in ('whatsapp', 'email', 'shopee_chat', 'lazada_chat', 'website')),
    constraint messages_direction_check
        check (direction is null or direction in ('inbound', 'outbound'))
);

create index messages_order_id_idx on messages (order_id);
create index messages_conversation_id_idx on messages (platform, conversation_id);
create index messages_raw_payload_gin_idx
    on messages using gin (raw_payload jsonb_path_ops);

-- ---------------------------------------------------------------------------
-- files
-- ---------------------------------------------------------------------------
create table files (
    id uuid primary key default gen_random_uuid(),
    order_id uuid references orders (id) on delete cascade,
    order_item_id uuid references order_items (id) on delete set null,
    message_id uuid references messages (id) on delete set null,
    original_filename text,
    mime_type text,
    file_size bigint,
    nas_path text,
    customer_notes text,
    shared_at timestamptz,
    created_at timestamptz not null default now()
);

create index files_order_id_idx on files (order_id);
create index files_order_item_id_idx on files (order_item_id);

-- ---------------------------------------------------------------------------
-- file_jobs
-- ---------------------------------------------------------------------------
create table file_jobs (
    id uuid primary key default gen_random_uuid(),
    file_id uuid not null references files (id) on delete cascade,
    status text not null default 'pending',
    final_filename text,
    checksum_sha256 text,
    error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz,

    constraint file_jobs_status_check
        check (status in ('pending', 'completed', 'human_review', 'failed'))
);

create index file_jobs_file_id_idx on file_jobs (file_id);
create index file_jobs_status_idx on file_jobs (status);

-- ---------------------------------------------------------------------------
-- support_cases
-- ---------------------------------------------------------------------------
create table support_cases (
    id uuid primary key default gen_random_uuid(),
    order_id uuid references orders (id) on delete set null,
    message_id uuid references messages (id) on delete set null,
    case_type text not null,
    status text not null default 'open',
    notes text,
    opened_at timestamptz not null default now(),
    closed_at timestamptz,

    constraint support_cases_case_type_check
        check (case_type in (
            'new_order', 'product_question', 'order_status', 'order_change',
            'address_change', 'after_sales', 'complaint', 'return_request',
            'cancel_request'
        )),
    constraint support_cases_status_check
        check (status in ('open', 'in_progress', 'waiting_customer',
                           'resolved', 'closed'))
);

create index support_cases_order_id_idx on support_cases (order_id);
create index support_cases_status_idx on support_cases (status);

-- ---------------------------------------------------------------------------
-- invoices
-- ---------------------------------------------------------------------------
create table invoices (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references orders (id) on delete cascade,
    invoice_number text not null unique,
    amount numeric(12, 2) not null,
    currency text not null default 'MYR',
    status text not null default 'draft',
    issued_at timestamptz,
    paid_at timestamptz,
    raw_payload jsonb,

    -- status vocabulary source: Stripe Invoice object
    -- https://docs.stripe.com/api/invoices/object (draft/open/paid/uncollectible/void),
    -- adapted per study/06-customer-service-workflow-expansion.md
    constraint invoices_status_check
        check (status in ('draft', 'sent', 'paid', 'overdue', 'void'))
);

create index invoices_order_id_idx on invoices (order_id);
create index invoices_status_idx on invoices (status);

-- ---------------------------------------------------------------------------
-- order_status_events (append-only audit trail)
-- ---------------------------------------------------------------------------
create table order_status_events (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references orders (id) on delete cascade,
    from_status text,
    to_status text not null,
    reason text,
    changed_by text,
    created_at timestamptz not null default now()
);

create index order_status_events_order_id_idx on order_status_events (order_id);

-- ---------------------------------------------------------------------------
-- print_jobs
-- ---------------------------------------------------------------------------
create table print_jobs (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references orders (id) on delete cascade,
    job_sheet_printed_at timestamptz,
    shipping_label_printed_at timestamptz,
    printed_by text,

    constraint print_jobs_order_id_unique unique (order_id)
);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Enabled default-deny on every table regardless of the port-3000 API's own
-- (currently absent) auth: Supabase exposes a public REST/GraphQL surface on
-- every project by default, and any table without RLS is reachable through
-- it. The Node API connects with the service_role key (bypasses RLS by
-- design), so this has no effect on the API's own behavior while closing the
-- public surface. See study/02-supabase-schema-design.md.
-- ---------------------------------------------------------------------------
alter table orders enable row level security;
alter table order_items enable row level security;
alter table messages enable row level security;
alter table files enable row level security;
alter table file_jobs enable row level security;
alter table support_cases enable row level security;
alter table invoices enable row level security;
alter table order_status_events enable row level security;
alter table print_jobs enable row level security;

-- ---------------------------------------------------------------------------
-- updated_at maintenance (orders only has a mutable status the API relies on
-- polling/observing freshness of; other tables are either append-only or
-- have an explicit *_at column the API sets directly)
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger orders_set_updated_at
    before update on orders
    for each row
    execute function set_updated_at();
