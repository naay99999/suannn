import { Input } from '@workspace/ui/components/input'
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/components/toggle-group'
import { presetLabels, type DateRange, type RangePreset } from '@/lib/marketing/format'

const presets = Object.keys(presetLabels) as RangePreset[]

function isPreset(value: unknown): value is RangePreset {
  return presets.some((preset) => preset === value)
}

export function DateRangePicker({ preset, range, onPresetChange, onCustomChange }: {
  preset: RangePreset
  range: DateRange
  onPresetChange: (preset: RangePreset) => void
  onCustomChange: (range: DateRange) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ToggleGroup
        aria-label="ช่วงเวลา"
        multiple={false}
        value={[preset]}
        onValueChange={(value) => {
          if (isPreset(value[0])) onPresetChange(value[0])
        }}
        variant="outline"
        size="sm"
      >
        {presets.map((option) => <ToggleGroupItem key={option} value={option}>{presetLabels[option]}</ToggleGroupItem>)}
      </ToggleGroup>
      {preset === 'custom' && (
        <div className="flex items-center gap-2">
          <Input aria-label="ตั้งแต่วันที่" className="w-40" max={range.to} onChange={(event) => event.target.value && onCustomChange({ from: event.target.value, to: range.to })} type="date" value={range.from} />
          <span className="text-muted-foreground">–</span>
          <Input aria-label="ถึงวันที่" className="w-40" min={range.from} onChange={(event) => event.target.value && onCustomChange({ from: range.from, to: event.target.value })} type="date" value={range.to} />
        </div>
      )}
    </div>
  )
}
