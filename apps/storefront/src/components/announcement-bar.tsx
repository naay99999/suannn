import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { InformationCircleIcon } from '@hugeicons/core-free-icons'
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from '@workspace/ui/components/popover'

import { storeAnnouncementQuery } from '@/lib/store-announcement'

const linkClass = 'font-semibold underline underline-offset-4 decoration-1 hover:decoration-2'

export function AnnouncementBar() {
  const { data: announcement } = useQuery(storeAnnouncementQuery)
  if (!announcement) return null

  const { message, linkLabel, linkUrl, details } = announcement
  const link = linkLabel && linkUrl
    ? linkUrl.startsWith('/')
      ? <Link className={linkClass} to={linkUrl}>{linkLabel}</Link>
      : <a className={linkClass} href={linkUrl} rel="noopener">{linkLabel}</a>
    : null

  return (
    <aside aria-label="โปรโมชัน" className="bg-primary text-primary-foreground">
      <p className="page-width flex min-h-10 flex-wrap items-center justify-center gap-x-1.5 py-2 text-center text-sm leading-6 font-medium">
        <span>{message}</span>
        {link}
        {details && (
          <Popover>
            <PopoverTrigger
              className="inline-flex size-7 items-center justify-center rounded-full hover:bg-primary-foreground/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-foreground"
              aria-label="รายละเอียดโปรโมชัน"
            >
              <HugeiconsIcon icon={InformationCircleIcon} className="size-4.5" aria-hidden="true" />
            </PopoverTrigger>
            <PopoverContent className="suannn-store text-left" sideOffset={8}>
              <PopoverTitle>รายละเอียดโปรโมชัน</PopoverTitle>
              <PopoverDescription className="leading-6 whitespace-pre-line">{details}</PopoverDescription>
            </PopoverContent>
          </Popover>
        )}
      </p>
    </aside>
  )
}
