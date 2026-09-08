import { Search } from "lucide-react";
import type { InputHTMLAttributes } from "react";

export function SearchInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="search-input">
      <Search size={16} aria-hidden="true" />
      <input type="search" {...props} />
    </label>
  );
}
