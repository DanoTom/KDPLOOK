/** Inline 20px stroke icons, so the app ships with no icon dependency. */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 18, children, ...rest }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" {...rest}
    >
      {children}
    </svg>
  );
}

export const Icon = {
  Compass: (p: IconProps) => <Base {...p}><circle cx="12" cy="12" r="9" /><path d="m15.2 8.8-2 5.4-5.4 2 2-5.4 5.4-2Z" /></Base>,
  Search: (p: IconProps) => <Base {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Base>,
  Tag: (p: IconProps) => <Base {...p}><path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9-9-9Z" /><circle cx="7.5" cy="7.5" r="1.3" /></Base>,
  Book: (p: IconProps) => <Base {...p}><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Z" /><path d="M4 19a2 2 0 0 1 2-2h13" /></Base>,
  Eye: (p: IconProps) => <Base {...p}><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" /><circle cx="12" cy="12" r="2.7" /></Base>,
  Bookmark: (p: IconProps) => <Base {...p}><path d="M6 3h12v18l-6-4.2L6 21V3Z" /></Base>,
  Sliders: (p: IconProps) => <Base {...p}><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></Base>,
  Activity: (p: IconProps) => <Base {...p}><path d="M3 12h4l3 8 4-16 3 8h4" /></Base>,
  Download: (p: IconProps) => <Base {...p}><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M4 19h16" /></Base>,
  Refresh: (p: IconProps) => <Base {...p}><path d="M20 11a8 8 0 1 0-1.9 6.3" /><path d="M20 20v-5h-5" /></Base>,
  Trash: (p: IconProps) => <Base {...p}><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M6 7l1 13h10l1-13" /></Base>,
  Star: (p: IconProps) => <Base {...p}><path d="m12 3.5 2.7 5.6 6 .9-4.3 4.2 1 6-5.4-2.9-5.4 2.9 1-6L3.3 10l6-.9L12 3.5Z" /></Base>,
  Plus: (p: IconProps) => <Base {...p}><path d="M12 5v14M5 12h14" /></Base>,
  X: (p: IconProps) => <Base {...p}><path d="m6 6 12 12M18 6 6 18" /></Base>,
  Check: (p: IconProps) => <Base {...p}><path d="m5 13 4 4 10-10" /></Base>,
  External: (p: IconProps) => <Base {...p}><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" /></Base>,
  Menu: (p: IconProps) => <Base {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Base>,
  Sun: (p: IconProps) => <Base {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" /></Base>,
  Moon: (p: IconProps) => <Base {...p}><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" /></Base>,
  Logout: (p: IconProps) => <Base {...p}><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" /><path d="M16 8l4 4-4 4M20 12H9" /></Base>,
  Alert: (p: IconProps) => <Base {...p}><path d="M12 4 2.5 20h19L12 4Z" /><path d="M12 10v4m0 3v.5" /></Base>,
  Info: (p: IconProps) => <Base {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5m0-8v.5" /></Base>,
  Calculator: (p: IconProps) => <Base {...p}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 12h2m3 0h3M8 16h2m3 0h3" /></Base>,
  Trend: (p: IconProps) => <Base {...p}><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></Base>,
  Save: (p: IconProps) => <Base {...p}><path d="M5 3h11l3 3v15H5V3Z" /><path d="M8 3v6h8V3M8 21v-7h8v7" /></Base>,
};
