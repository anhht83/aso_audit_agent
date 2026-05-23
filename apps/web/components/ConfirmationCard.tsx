'use client'

import type { AppListing } from '@aso/shared'
import { Button, Card } from './ui/primitives'

interface Props {
  listing: AppListing
  onConfirm: () => void
  onReject: () => void
  disabled?: boolean
}

export function ConfirmationCard({ listing, onConfirm, onReject, disabled }: Props) {
  return (
    <Card className="flex flex-col gap-4">
      <div className="text-sm text-textDim">Is this the app you meant?</div>
      <div className="flex items-start gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={listing.iconUrl}
          alt=""
          className="h-16 w-16 flex-shrink-0 rounded-2xl border border-border object-cover"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold">{listing.name}</div>
          <div className="truncate text-sm text-textDim">{listing.developer}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-textDim">
            <span>{listing.category}</span>
            <span>·</span>
            <span>{listing.country.toUpperCase()} store</span>
            {listing.averageRating !== null && (
              <>
                <span>·</span>
                <span>
                  {listing.averageRating.toFixed(1)}★
                  {listing.ratingCount !== null && ` (${listing.ratingCount.toLocaleString()})`}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <Button onClick={onConfirm} disabled={disabled}>
          Yes, audit this
        </Button>
        <Button variant="secondary" onClick={onReject} disabled={disabled}>
          No, wrong app
        </Button>
      </div>
    </Card>
  )
}
