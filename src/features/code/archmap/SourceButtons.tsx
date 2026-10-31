// Quiet buttons on a card: one per file behind it. A file a component
// names but that is gone stays visible and says so.
import { sourceTabsOf, type SourceSymbol } from "./sourceTabs";

export function SourceButtons({
  symbol,
  onOpen,
}: {
  symbol: SourceSymbol;
  onOpen: (symbol: SourceSymbol, tabKey: string) => void;
}) {
  return (
    <span className="archboard-sources" role="group" aria-label={`Files of ${symbol.name}`}>
      {sourceTabsOf(symbol).map((tab) => (
        <button
          key={tab.key}
          type="button"
          className="archboard-source"
          aria-label={`View ${tab.label} of ${symbol.name}`}
          title={tab.missing ? `${tab.rel} (not found)` : tab.rel}
          disabled={tab.missing}
          onClick={() => onOpen(symbol, tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </span>
  );
}
