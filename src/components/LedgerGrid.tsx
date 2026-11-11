"use client";

import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type GridApi,
  type GridSizeChangedEvent,
  type ICellRendererParams,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { formatUsd } from "@/domain/money";
import { STATUS_LABELS, aiLabel, formatTime, ruleLabel } from "@/lib/labels";
import type { PurchaseView } from "@/lib/views";
import { StatusBadge } from "./StatusBadge";

ModuleRegistry.registerModules([AllCommunityModule]);

export type LedgerAction = "approve" | "deny" | "refund" | "recheck";

type Props = {
  purchases: PurchaseView[];
  busyId: string | null;
  readOnly: boolean;
  onAction: (purchase: PurchaseView, action: LedgerAction) => void;
};

type Context = Pick<Props, "busyId" | "readOnly" | "onAction">;

// Flat, with row dividers only, drawn from Kitty's tokens (rules.md).
const theme = themeQuartz.withParams({
  fontFamily: "inherit",
  fontSize: 14,
  backgroundColor: "#ffffff",
  foregroundColor: "#000000",
  headerBackgroundColor: "#ffffff",
  headerTextColor: "#686a6d",
  headerFontWeight: 600,
  borderColor: "rgba(0, 0, 0, 0.1)",
  accentColor: "#0066f5",
  rowHoverColor: "rgba(5, 55, 130, 0.04)",
  wrapperBorder: false,
  columnBorder: false,
  headerColumnBorder: false,
  headerColumnResizeHandleColor: "transparent",
  rowBorder: true,
  wrapperBorderRadius: 0,
  cellHorizontalPadding: 14,
  spacing: 8,
});

/**
 * The owner's ledger: one row per purchase attempt, with the rule result, the
 * AI check and the status side by side, and the owner's decisions in the last
 * column. Rows update in place as the dashboard polls.
 */
export function LedgerGrid({ purchases, busyId, readOnly, onAction }: Props) {
  const filterId = useId();
  const apiRef = useRef<GridApi<PurchaseView> | null>(null);
  const [filter, setFilter] = useState("");
  const context = useMemo<Context>(() => ({ busyId, readOnly, onAction }), [busyId, readOnly, onAction]);

  const columns = useMemo<ColDef<PurchaseView>[]>(
    () => [
      {
        colId: "time",
        headerName: "Time",
        field: "createdAt",
        width: 100,
        sort: "desc",
        valueFormatter: (params) => (params.value ? formatTime(params.value) : ""),
        cellClass: "money",
      },
      {
        colId: "who",
        headerName: "Who",
        field: "memberLabel",
        width: 160,
        cellRenderer: WhoCell,
      },
      {
        colId: "item",
        headerName: "Item",
        field: "title",
        flex: 2,
        minWidth: 200,
        wrapText: true,
        autoHeight: true,
        getQuickFilterText: (params) => `${params.data?.title} ${params.data?.store}`,
        cellRenderer: ItemCell,
      },
      {
        colId: "amount",
        headerName: "Amount",
        field: "amountCents",
        width: 112,
        type: "rightAligned",
        cellClass: "money",
        valueFormatter: (params) => formatUsd(params.value ?? 0),
      },
      {
        colId: "rules",
        headerName: "Rules",
        width: 158,
        valueGetter: (params) => (params.data ? ruleLabel(params.data) : ""),
      },
      {
        colId: "ai",
        headerName: "AI check",
        flex: 2,
        minWidth: 220,
        wrapText: true,
        autoHeight: true,
        valueGetter: (params) => (params.data ? aiLabel(params.data) : ""),
        getQuickFilterText: (params) => `${params.data ? aiLabel(params.data) : ""} ${params.data?.aiReason ?? ""}`,
        cellRenderer: AiCell,
      },
      {
        colId: "status",
        headerName: "Status",
        field: "status",
        width: 186,
        valueGetter: (params) => (params.data ? STATUS_LABELS[params.data.status].label : ""),
        cellRenderer: (params: ICellRendererParams<PurchaseView>) =>
          params.data ? <StatusBadge status={params.data.status} /> : null,
      },
      {
        colId: "decision",
        headerName: "Decision",
        width: 206,
        pinned: "right",
        sortable: false,
        resizable: false,
        // Let Tab reach the buttons inside the cell instead of skipping to the next cell.
        suppressKeyboardEvent: ({ event }) => event.key === "Tab",
        cellRenderer: DecisionCell,
      },
    ],
    [],
  );

  const onGridSizeChanged = useCallback((event: GridSizeChangedEvent<PurchaseView>) => {
    // On narrow screens keep who, what, how much and the decision.
    event.api.setColumnsVisible(["time", "rules"], event.clientWidth >= 900);
    event.api.setColumnsVisible(["ai"], event.clientWidth >= 700);
    event.api.setColumnsVisible(["who"], event.clientWidth >= 560);
    event.api.setColumnsPinned(["decision"], event.clientWidth >= 560 ? "right" : null);
  }, []);

  function exportCsv() {
    apiRef.current?.exportDataAsCsv({
      fileName: "kitty-ledger.csv",
      columnKeys: ["time", "who", "item", "amount", "rules", "ai", "status"],
    });
  }

  return (
    <div className="stack">
      <div className="row row--between">
        <div className="field" style={{ flex: "1 1 220px", maxWidth: 320 }}>
          <label htmlFor={filterId} className="visually-hidden">
            Filter the ledger
          </label>
          <input
            id={filterId}
            className="input"
            type="search"
            placeholder="Filter, for example Sam or flagged"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
        <button type="button" className="button button--secondary button--small" onClick={exportCsv}>
          Export CSV
        </button>
      </div>
      <div className="ledger">
        <AgGridReact<PurchaseView>
          theme={theme}
          rowData={purchases}
          columnDefs={columns}
          context={context}
          getRowId={(params) => params.data.id}
          domLayout="autoHeight"
          rowHeight={56}
          headerHeight={44}
          quickFilterText={filter}
          pagination={purchases.length > 15}
          paginationPageSize={15}
          paginationPageSizeSelector={false}
          suppressCellFocus={false}
          enableCellTextSelection
          defaultColDef={{ sortable: true, resizable: true, suppressMovable: true }}
          overlayNoRowsTemplate="No matching purchases."
          onGridReady={(event) => {
            apiRef.current = event.api;
          }}
          onGridSizeChanged={onGridSizeChanged}
        />
      </div>
    </div>
  );
}

function WhoCell({ data }: ICellRendererParams<PurchaseView>) {
  if (!data) return null;
  return (
    <div className="cell-two-line">
      <span>{data.memberLabel}</span>
      <span>{data.memberKind === "agent" ? "AI agent" : "Family"}</span>
    </div>
  );
}

function ItemCell({ data }: ICellRendererParams<PurchaseView>) {
  if (!data) return null;
  return (
    <div className="cell-two-line">
      <span>
        {data.title}
        {data.quantity > 1 ? ` × ${data.quantity}` : ""}
      </span>
      <span>{data.store}</span>
    </div>
  );
}

function AiCell({ data }: ICellRendererParams<PurchaseView>) {
  if (!data) return null;
  return (
    <div className="cell-two-line">
      <span>{aiLabel(data)}</span>
      {data.aiReason && <span>{data.aiReason}</span>}
    </div>
  );
}

function DecisionCell({ data, context }: ICellRendererParams<PurchaseView, unknown, Context>) {
  if (!data || context.readOnly) return null;
  const busy = context.busyId === data.id;
  const button = (action: LedgerAction, label: string, kind: "primary" | "secondary" = "secondary") => (
    <button
      type="button"
      className={kind === "primary" ? "button button--small" : "button button--secondary button--small"}
      disabled={busy}
      aria-label={`${label} ${data.title}`}
      onClick={() => context.onAction(data, action)}
    >
      {label}
    </button>
  );

  if (data.status === "awaiting_approval") {
    return (
      <div className="cell-actions">
        {button("approve", "Approve", "primary")}
        {button("deny", "Deny")}
      </div>
    );
  }
  if (data.status === "captured") return <div className="cell-actions">{button("refund", "Refund")}</div>;
  if (data.status === "capture_unknown" || data.status === "refund_pending") {
    return <div className="cell-actions">{button(data.status === "refund_pending" ? "refund" : "recheck", "Check again")}</div>;
  }
  return null;
}
