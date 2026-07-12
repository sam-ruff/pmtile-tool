import { layers, namedFlavor } from '@protomaps/basemaps'
import type { Flavor, Pois } from '@protomaps/basemaps'

export type FlavourName = 'light' | 'dark' | 'white' | 'grayscale' | 'black'

export const FLAVOUR_NAMES: FlavourName[] = ['light', 'dark', 'white', 'grayscale', 'black']

export const FLAVOUR_LABELS: Record<FlavourName, string> = {
  light: 'Light',
  dark: 'Dark',
  white: 'White',
  grayscale: 'Greyscale',
  black: 'Black',
}

type Landcover = NonNullable<Flavor['landcover']>

/// Partial colour overrides applied on top of a preset flavour. The nested
/// pois/landcover records are themselves partial so a single icon or landcover
/// colour can be overridden without restating the rest.
export interface FlavourOverrides extends Partial<Omit<Flavor, 'pois' | 'landcover'>> {
  pois?: Partial<Pois>
  landcover?: Partial<Landcover>
}

export interface CustomMapStyle {
  id: string
  name: string
  base: FlavourName
  overrides: FlavourOverrides
}

/// A style choice resolved to the concrete flavour the map renders with. The
/// base/overrides recipe rides along so exports can embed it.
export interface ResolvedMapStyle {
  id: string
  name: string
  base: FlavourName
  overrides: FlavourOverrides
  flavor: Flavor
}

export function isFlavourName(value: unknown): value is FlavourName {
  return typeof value === 'string' && (FLAVOUR_NAMES as string[]).includes(value)
}

export function resolveFlavour(base: FlavourName, overrides: FlavourOverrides): Flavor {
  const { pois, landcover, ...flat } = overrides
  const baseFlavour = namedFlavor(base)
  const resolved: Flavor = { ...baseFlavour, ...flat }
  // pois/landcover only exist on some presets; overrides make no sense without
  // a base to merge into, so they are dropped for presets that lack them.
  if (baseFlavour.pois) resolved.pois = { ...baseFlavour.pois, ...pois }
  if (baseFlavour.landcover) resolved.landcover = { ...baseFlavour.landcover, ...landcover }
  return resolved
}

/// Build the Protomaps gl style for a source. Custom styles keep their base
/// preset's sprite sheet since icon colours are not customisable.
export function glStyleForFlavour(sourceId: string, flavor: Flavor, spriteBase: FlavourName) {
  return {
    version: 8,
    sprite: `${window.location.origin}/basemaps-assets/sprites/v4/${spriteBase}`,
    sources: { [sourceId]: { type: 'vector' as const } },
    layers: layers(sourceId, flavor, { lang: 'en' }),
  }
}

/// Colour picker inputs only accept #rrggbb; flavours mix hex and rgba().
export function toHexColour(value: string): string {
  const trimmed = value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase()
  const short = trimmed.match(/^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/)
  if (short) {
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase()
  }
  const rgba = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (rgba) {
    const channel = (v: string) =>
      Math.min(255, Number(v)).toString(16).padStart(2, '0')
    return `#${channel(rgba[1])}${channel(rgba[2])}${channel(rgba[3])}`
  }
  return '#000000'
}

type FlatFlavourField = keyof Omit<Flavor, 'pois' | 'landcover' | 'regular' | 'bold' | 'italic'>

export interface FlavourGroup {
  key: string
  label: string
  /// Curated groups render as a single bulk colour control; the rest only
  /// appear in the advanced section.
  curated: boolean
  fields: FlatFlavourField[]
}

/// Every flat Flavor colour field appears in exactly one group (unit-tested)
/// so the editor stays complete when the upstream package adds fields.
export const FLAVOUR_GROUPS: FlavourGroup[] = [
  { key: 'background', label: 'Background', curated: true, fields: ['background'] },
  { key: 'land', label: 'Land', curated: true, fields: ['earth'] },
  { key: 'water', label: 'Water', curated: true, fields: ['water'] },
  { key: 'buildings', label: 'Buildings', curated: true, fields: ['buildings'] },
  {
    key: 'roads',
    label: 'Roads',
    curated: true,
    fields: ['highway', 'major', 'minor_a', 'minor_b', 'link', 'minor_service', 'other'],
  },
  {
    key: 'label-text',
    label: 'Label text',
    curated: true,
    fields: [
      'city_label',
      'subplace_label',
      'state_label',
      'country_label',
      'ocean_label',
      'address_label',
      'roads_label_minor',
      'roads_label_major',
    ],
  },
  {
    key: 'label-halos',
    label: 'Label halos',
    curated: true,
    fields: [
      'city_label_halo',
      'subplace_label_halo',
      'state_label_halo',
      'address_label_halo',
      'roads_label_minor_halo',
      'roads_label_major_halo',
    ],
  },
  {
    key: 'road-casings',
    label: 'Road casings and rail',
    curated: false,
    fields: [
      'highway_casing_early',
      'highway_casing_late',
      'major_casing_early',
      'major_casing_late',
      'minor_casing',
      'minor_service_casing',
      'link_casing',
      'railway',
    ],
  },
  {
    key: 'tunnels',
    label: 'Tunnels',
    curated: false,
    fields: [
      'tunnel_highway',
      'tunnel_major',
      'tunnel_minor',
      'tunnel_link',
      'tunnel_other',
      'tunnel_highway_casing',
      'tunnel_major_casing',
      'tunnel_minor_casing',
      'tunnel_link_casing',
      'tunnel_other_casing',
    ],
  },
  {
    key: 'bridges',
    label: 'Bridges',
    curated: false,
    fields: [
      'bridges_highway',
      'bridges_major',
      'bridges_minor',
      'bridges_link',
      'bridges_other',
      'bridges_highway_casing',
      'bridges_major_casing',
      'bridges_minor_casing',
      'bridges_link_casing',
      'bridges_other_casing',
    ],
  },
  {
    key: 'landuse',
    label: 'Land use',
    curated: false,
    fields: [
      'park_a',
      'park_b',
      'wood_a',
      'wood_b',
      'scrub_a',
      'scrub_b',
      'glacier',
      'sand',
      'beach',
      'hospital',
      'industrial',
      'school',
      'pedestrian',
      'aerodrome',
      'runway',
      'zoo',
      'military',
      'pier',
    ],
  },
  { key: 'boundaries', label: 'Boundaries', curated: false, fields: ['boundaries'] },
]

export const POIS_FIELDS: (keyof Pois)[] = [
  'blue',
  'green',
  'lapis',
  'pink',
  'red',
  'slategray',
  'tangerine',
  'turquoise',
]

export const LANDCOVER_FIELDS: (keyof Landcover)[] = [
  'barren',
  'farmland',
  'forest',
  'glacier',
  'grassland',
  'scrub',
  'urban_area',
]

export function fieldLabel(field: string): string {
  const spaced = field.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
