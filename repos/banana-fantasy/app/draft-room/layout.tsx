export default function DraftRoomLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Hide Footer and any site chrome — draft room is a full-screen experience */}
      <style>{`
        footer, [data-site-footer], .site-footer { display: none !important; }
        header, [data-site-header] { display: none !important; }
        body > div > div.flex.flex-col.min-h-screen > footer { display: none !important; }
        body > div > div.flex.flex-col.min-h-screen > div.flex-1 > footer { display: none !important; }
      `}</style>
      {children}
    </>
  );
}
