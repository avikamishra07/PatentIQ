import React from "react";
import { T } from "../theme.js";

// Minimal 20px stroke icons (same family as the original app).
const Icon = ({ children, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const IconDashboard = (p) => <Icon {...p}><rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/></Icon>;
export const IconClassify = (p) => <Icon {...p}><path d="M3.5 12.5V5a1.5 1.5 0 0 1 1.5-1.5h7.5L20.5 11.5 12.5 19.5 3.5 12.5Z"/><circle cx="8" cy="8.5" r="1.2"/></Icon>;
export const IconSimilar = (p) => <Icon {...p}><rect x="3.5" y="3.5" width="11" height="13" rx="1.5"/><path d="M9.5 20.5h9a2 2 0 0 0 2-2V9"/><path d="M7 8.5h4M7 12h4"/></Icon>;
export const IconSuggest = (p) => <Icon {...p}><path d="M12 3.5l2.2 5.3 5.3 2.2-5.3 2.2L12 18.5l-2.2-5.3-5.3-2.2 5.3-2.2L12 3.5Z"/><path d="M19 17v4M17 19h4"/></Icon>;
export const IconTable = (p) => <Icon {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10"/></Icon>;
export const IconChart = (p) => <Icon {...p}><path d="M3.5 19.5h17"/><path d="M6.5 16.5v-5M11 16.5v-9M15.5 16.5v-6.5M20 16.5v-3"/></Icon>;
export const IconReport = (p) => <Icon {...p}><path d="M13 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5L13 3.5Z"/><path d="M13 3.5V8.5H18"/><path d="M8.5 13h7M8.5 16.5h5"/></Icon>;
export const IconPulse = (p) => <Icon {...p}><path d="M3 12h4l2.5-6 4 12 2.5-6H21"/></Icon>;
export const IconSearch = (p) => <Icon {...p}><circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.8-4.8"/></Icon>;
export const IconMenu = (p) => <Icon {...p}><path d="M4 6.5h16M4 12h16M4 17.5h16"/></Icon>;
export const IconClose = (p) => <Icon {...p}><path d="M6 6l12 12M18 6L6 18"/></Icon>;
export const IconDownload = (p) => <Icon {...p}><path d="M12 4v11M7.5 11 12 15.5 16.5 11"/><path d="M4.5 19.5h15"/></Icon>;
export const IconAlert = (p) => <Icon {...p}><path d="M12 3.5 21.5 20h-19L12 3.5Z"/><path d="M12 10v4.5M12 17.2v.1"/></Icon>;
export const IconInbox = (p) => <Icon {...p}><path d="M3.5 13.5 6 5.5h12l2.5 8"/><path d="M3.5 13.5v5a1 1 0 0 0 1 1h15a1 1 0 0 0 1-1v-5h-5l-1.5 2.5h-4L8.5 13.5h-5Z"/></Icon>;

export const LogoMark = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 3.5A1.5 1.5 0 0 1 7.5 2H14l4.5 4.5V19a1.5 1.5 0 0 1-1.5 1.5h-2" stroke={T.navy} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M14 2v4.2A1.3 1.3 0 0 0 15.3 7.5H18.5" stroke={T.navy} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="8.7" cy="14.2" r="3.5" stroke={T.accent} strokeWidth="1.6"/>
    <path d="M11.2 16.7 13.5 19" stroke={T.accent} strokeWidth="1.6" strokeLinecap="round"/>
  </svg>
);
