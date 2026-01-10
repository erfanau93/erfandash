import React from 'react'

type BreadcrumbItem = {
  label: string
  href?: string
}

export default function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  if (!items || items.length === 0) return null

  return (
    <nav className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]" aria-label="Breadcrumb">
      {items.map((item, idx) => (
        <React.Fragment key={`${item.label}-${idx}`}>
          {idx > 0 && <span className="opacity-60">/</span>}
          {item.href ? (
            <a
              href={item.href}
              className="text-cyan-300 hover:text-cyan-200 transition-colors"
            >
              {item.label}
            </a>
          ) : (
            <span className="text-white">{item.label}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  )
}


