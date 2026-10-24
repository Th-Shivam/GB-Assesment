type Name = 'wind' | 'grid' | 'chart' | 'clock' | 'book' | 'refresh' | 'arrow' | 'info' | 'calendar'
const paths: Record<Name, string[]> = {
  wind: ['M3 8h12a3 3 0 1 0-3-3', 'M3 12h18', 'M3 16h9a3 3 0 1 1-3 3'],
  grid: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
  chart: ['M3 3v18h18', 'm6 14 4-4 4 3 6-7'],
  clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M12 7v5l3 2'],
  book: ['M4 3h13a3 3 0 0 1 3 3v15H7a3 3 0 0 1-3-3z', 'M4 17h16', 'M8 7h8', 'M8 11h6'],
  refresh: ['M20 7v5h-5', 'M4 17v-5h5', 'M6 7a7 7 0 0 1 12-2l2 3', 'M18 17a7 7 0 0 1-12 2l-2-3'],
  arrow: ['M5 12h14', 'm14 7 5 5-5 5'],
  info: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M12 11v6', 'M12 7v.01'],
  calendar: ['M4 5h16v16H4z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
}

export function Icon({ name, className = '' }: { name: Name; className?: string }) {
  return <svg className={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {paths[name].map((path) => <path key={path} d={path} />)}
  </svg>
}
