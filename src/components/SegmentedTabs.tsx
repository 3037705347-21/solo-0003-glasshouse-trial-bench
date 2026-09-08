interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedTabsProps<T extends string> {
  value: T;
  options: Array<SegmentOption<T>>;
  onChange: (value: T) => void;
  label: string;
}

export function SegmentedTabs<T extends string>({
  value,
  options,
  onChange,
  label,
}: SegmentedTabsProps<T>) {
  return (
    <div className="segmented-tabs" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          className={value === option.value ? "segment-active" : ""}
          key={option.value}
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
