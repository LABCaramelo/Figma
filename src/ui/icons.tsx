import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function make(paths: ReactNode, viewBox = '0 0 24 24') {
  return function Icon({ size = 24, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox={viewBox}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...rest}
      >
        {paths}
      </svg>
    );
  };
}

// ferramentas
export const IconMove = make(<path d="M7.5 5.5v12.2l3.3-3.2 2.3 5 2-.9-2.3-5h4.6z" fill="currentColor" stroke="none" />);
export const IconHand = make(
  <path d="M9 11.5V6.8a1.2 1.2 0 0 1 2.4 0v4.2-5.6a1.2 1.2 0 0 1 2.4 0V11V6.6a1.2 1.2 0 0 1 2.4 0v5.2-3.4a1.2 1.2 0 0 1 2.3 0v5.8c0 3.3-2.3 5.8-5.6 5.8h-.6c-1.8 0-3-.7-4.1-2l-3-3.8a1.2 1.2 0 0 1 1.8-1.6L9 14.5z" />,
);
export const IconFrame = make(<path d="M8.5 4.5v15M15.5 4.5v15M4.5 8.5h15M4.5 15.5h15" />);
export const IconRect = make(<rect x="5.5" y="5.5" width="13" height="13" rx="0.5" />);
export const IconEllipse = make(<circle cx="12" cy="12" r="6.5" />);
export const IconLine = make(<path d="M5.5 18.5 18.5 5.5" />);
export const IconArrow = make(<path d="M5.5 18.5 18.5 5.5M11 5.5h7.5V13" />);
export const IconPolygon = make(<path d="M12 5.5 19 18.5H5z" />);
export const IconStar = make(
  <path d="m12 4.8 2.2 4.6 5 .6-3.7 3.5.9 5-4.4-2.5-4.4 2.5.9-5L4.8 10l5-.6z" />,
);
export const IconPencil = make(<path d="M15.5 5.5 18.5 8.5 9 18l-4 1 1-4zM13.5 7.5l3 3" />);
export const IconText = make(<path d="M6.5 7V5.5h11V7M12 5.5v13M9.5 18.5h5" />);
export const IconImage = make(
  <>
    <rect x="4.5" y="5.5" width="15" height="13" rx="1" />
    <circle cx="9" cy="10" r="1.5" />
    <path d="m4.5 16 4-4 3 3 3-3 5 5" />
  </>,
);
export const IconVector = make(
  <>
    <path d="M6 18c1-6 4-9 12-12" />
    <circle cx="6" cy="18" r="1.5" />
    <circle cx="18" cy="6" r="1.5" />
  </>,
);
export const IconGroup = make(<rect x="5.5" y="5.5" width="13" height="13" rx="0.5" strokeDasharray="2 2" />);
export const IconPage = make(<path d="M7.5 4.5h6l3 3v12h-9zM13.5 4.5v3h3" />);

// interface
export const IconChevronDown = make(<path d="m8 10.5 4 4 4-4" />);
export const IconChevronRight = make(<path d="m10.5 8 4 4-4 4" />);
export const IconCaretDown = make(<path d="M9 10.5h6l-3 3.5z" fill="currentColor" stroke="none" />);
export const IconCaretRight = make(<path d="M10.5 9v6l3.5-3z" fill="currentColor" stroke="none" />);
export const IconPlus = make(<path d="M12 6.5v11M6.5 12h11" />);
export const IconMinus = make(<path d="M6.5 12h11" />);
export const IconAutoLayoutH = make(
  <>
    <rect x="4" y="6" width="6" height="12" rx="1" />
    <rect x="14" y="6" width="6" height="12" rx="1" />
  </>,
);
export const IconAutoLayoutV = make(
  <>
    <rect x="6" y="4" width="12" height="6" rx="1" />
    <rect x="6" y="14" width="12" height="6" rx="1" />
  </>,
);
export const IconCheck = make(<path d="m7 12.5 3.2 3L17 8.5" />);
export const IconClose = make(<path d="m7.5 7.5 9 9M16.5 7.5l-9 9" />);
export const IconEye = make(
  <>
    <path d="M4 12s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z" />
    <circle cx="12" cy="12" r="2.2" />
  </>,
);
export const IconEyeOff = make(
  <>
    <path d="M4 12s3-5 8-5c1.4 0 2.6.4 3.6 1M20 12s-3 5-8 5c-1.4 0-2.6-.4-3.6-1" />
    <path d="m5.5 18.5 13-13" />
  </>,
);
export const IconLock = make(
  <>
    <rect x="7.5" y="11.5" width="9" height="7" rx="1" />
    <path d="M9.5 11.5V9a2.5 2.5 0 0 1 5 0v2.5" />
  </>,
);
export const IconUnlock = make(
  <>
    <rect x="7.5" y="11.5" width="9" height="7" rx="1" />
    <path d="M9.5 11.5V9a2.5 2.5 0 0 1 4.8-1" />
  </>,
);
export const IconLink = make(
  <path d="M10.5 13.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.8.8M13.5 10.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.8-.8" />,
);
export const IconUnlink = make(
  <path d="M14.7 13.5l2.6-2.6a3 3 0 0 0-4.2-4.2l-.8.8M9.3 10.5l-2.6 2.6a3 3 0 0 0 4.2 4.2l.8-.8M7 7l10 10" />,
);
export const IconRotate = make(<path d="M17.5 12a5.5 5.5 0 1 1-1.6-3.9M16.5 4.8v3.6h-3.6" />);
export const IconFlipH = make(
  <>
    <path d="M12 4.5v15" strokeDasharray="1.5 1.5" />
    <path d="M9.5 7.5v9l-4.5-4.5zM14.5 7.5v9l4.5-4.5z" />
  </>,
);
export const IconFlipV = make(
  <>
    <path d="M4.5 12h15" strokeDasharray="1.5 1.5" />
    <path d="M7.5 9.5h9L12 5zM7.5 14.5h9L12 19z" />
  </>,
);
export const IconRotate90 = make(
  <>
    <path d="M7.5 9.5h9v9h-9z" />
    <path d="M10 5.5h3.5a4 4 0 0 1 4 4M15.6 7.6l1.9 1.9 1.9-1.9" />
  </>,
);
export const IconCorner = make(<path d="M6.5 17.5V11a4.5 4.5 0 0 1 4.5-4.5h6.5" />);
export const IconOpacity = make(
  <>
    <circle cx="12" cy="12" r="6.5" />
    <path d="M12 5.5v13" />
    <path d="M12 5.5a6.5 6.5 0 0 1 0 13z" fill="currentColor" stroke="none" opacity="0.35" />
  </>,
);
export const IconClip = make(<path d="M8.5 4.5v11h11M4.5 8.5h11v11" />);
export const IconStrokeWeight = make(<path d="M6 8h12M6 12h12" strokeWidth={1.5} />);
export const IconLineHeight = make(<path d="M5.5 5.5h13M5.5 18.5h13M9 15.5l3-7 3 7M10 13.5h4" />);
export const IconLetterSpacing = make(<path d="M5.5 5.5v13M18.5 5.5v13M9 15.5l3-7 3 7M10 13.5h4" />);
export const IconTextLeft = make(<path d="M5.5 7.5h13M5.5 12h8M5.5 16.5h11" />);
export const IconTextCenter = make(<path d="M5.5 7.5h13M8 12h8M6.5 16.5h11" />);
export const IconTextRight = make(<path d="M5.5 7.5h13M10.5 12h8M7.5 16.5h11" />);
export const IconAutoWidth = make(<path d="M4.5 12h15M7 9.5 4.5 12 7 14.5M17 9.5l2.5 2.5-2.5 2.5" />);
export const IconAutoHeight = make(<path d="M12 4.5v15M9.5 7 12 4.5 14.5 7M9.5 17l2.5 2.5 2.5-2.5" />);
export const IconFixedSize = make(<rect x="6.5" y="6.5" width="11" height="11" rx="0.5" />);
export const IconStyles = make(
  <>
    <circle cx="8.5" cy="8.5" r="2" />
    <circle cx="15.5" cy="8.5" r="2" />
    <circle cx="8.5" cy="15.5" r="2" />
    <circle cx="15.5" cy="15.5" r="2" />
  </>,
);
export const IconExport = make(<path d="M12 14.5v-9M8.5 9 12 5.5 15.5 9M6.5 13.5v5h11v-5" />);
export const IconSun = make(
  <>
    <circle cx="12" cy="12" r="3.5" />
    <path d="M12 4v1.5M12 18.5V20M4 12h1.5M18.5 12H20M6.3 6.3l1.1 1.1M16.6 16.6l1.1 1.1M6.3 17.7l1.1-1.1M16.6 7.4l1.1-1.1" />
  </>,
);
export const IconMoon = make(<path d="M17.5 14.5A6.5 6.5 0 0 1 9.5 6.5a6.5 6.5 0 1 0 8 8z" />);
export const IconKeyboard = make(
  <>
    <rect x="4.5" y="7.5" width="15" height="9" rx="1" />
    <path d="M7.5 10.5h1M10.5 10.5h1M13.5 10.5h1M16 10.5h.5M8.5 13.5h7" />
  </>,
);

// alinhamento
export const IconAlignLeft = make(<path d="M5.5 4.5v15M8.5 8.5h9v2h-9zM8.5 13.5h5v2h-5z" />);
export const IconAlignHCenter = make(<path d="M12 4.5v15M7.5 8.5h9v2h-9zM9.5 13.5h5v2h-5z" />);
export const IconAlignRight = make(<path d="M18.5 4.5v15M6.5 8.5h9v2h-9zM10.5 13.5h5v2h-5z" />);
export const IconAlignTop = make(<path d="M4.5 5.5h15M8.5 8.5h2v9h-2zM13.5 8.5h2v5h-2z" />);
export const IconAlignVCenter = make(<path d="M4.5 12h15M8.5 7.5h2v9h-2zM13.5 9.5h2v5h-2z" />);
export const IconAlignBottom = make(<path d="M4.5 18.5h15M8.5 6.5h2v9h-2zM13.5 10.5h2v5h-2z" />);
export const IconDistH = make(<path d="M5.5 5.5v13M18.5 5.5v13M10.5 8.5h3v7h-3z" />);
export const IconDistV = make(<path d="M5.5 5.5h13M5.5 18.5h13M8.5 10.5h7v3h-7z" />);

// componentes e operações booleanas
export const IconComponent = make(
  <>
    <path d="M12 4.5 14.5 7 12 9.5 9.5 7z" fill="currentColor" stroke="none" />
    <path d="M12 14.5 14.5 17 12 19.5 9.5 17z" fill="currentColor" stroke="none" />
    <path d="M7 9.5 9.5 12 7 14.5 4.5 12z" fill="currentColor" stroke="none" />
    <path d="M17 9.5 19.5 12 17 14.5 14.5 12z" fill="currentColor" stroke="none" />
  </>,
);
export const IconInstance = make(<path d="M12 4.5 19.5 12 12 19.5 4.5 12z" />);
export const IconUnion = make(
  <>
    <rect x="5" y="8" width="9" height="9" rx="1.5" />
    <rect x="10" y="5" width="9" height="9" rx="1.5" />
  </>,
);
export const IconSubtract = make(
  <>
    <path d="M5 5h7v5h-5v5H5z" />
    <rect x="10" y="10" width="9" height="9" rx="1" strokeDasharray="1.5 1.5" />
  </>,
);
export const IconIntersect = make(
  <>
    <rect x="5" y="5" width="9" height="9" rx="1" />
    <rect x="10" y="10" width="9" height="9" rx="1" />
    <rect x="10" y="10" width="4" height="4" fill="currentColor" stroke="none" opacity="0.4" />
  </>,
);
export const IconExclude = make(
  <>
    <rect x="5" y="5" width="9" height="9" rx="1" />
    <rect x="10" y="10" width="9" height="9" rx="1" />
    <path d="m10 10 4 4m0-4-4 4" strokeWidth={1} />
  </>,
);
export const IconPen = make(<path d="m12 4 4 4-8 10-4 1 1-4L12 4zM10 6l3 3" />);

/** Logotipo da Prancheta (botão do menu principal). */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="6" fill="#0D99FF" />
      <path d="M9 17V7h4.2a3.3 3.3 0 0 1 0 6.6H9" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
