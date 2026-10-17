/** The neutral content of the fixture sites: botanical prints. Images are generated gradients (see gen.mjs). */
export const NAMES = [
    'Fern frond', 'Ginkgo leaf', 'Oak branch', 'Maple seeds', 'Lavender stem', 'Poppy bud',
    'Thistle head', 'Clover patch', 'Birch catkin', 'Pine cone', 'Moss study', 'Willow twig',
    'Daisy field', 'Nettle leaf', 'Ivy vine', 'Bracken curl', 'Rose hip', 'Hazel nut',
    'Sage leaf', 'Yarrow bloom', 'Foxglove spire', 'Bluebell row', 'Dandelion clock', 'Heather sprig',
];
export const IMAGES = NAMES.length;
const ASPECTS = [0.75, 1, 1.33, 0.8, 1.5, 0.62, 1.2, 0.7];

export const pad = (n) => String(n + 1).padStart(2, '0');

/** Print number n (0-based). Numbers past the image count reuse an image. */
export function print(n) {
    const i = n % IMAGES;
    return {
        n,
        id: `print-${String(n + 1).padStart(3, '0')}`,
        title: NAMES[i] + (n >= IMAGES ? ` (${Math.floor(n / IMAGES) + 1})` : ''),
        subtitle: `Plate ${n + 1}`,
        aspect: ASPECTS[i % ASPECTS.length],
        image: i,
        badges: n % 6 === 0 ? ['new'] : [],
    };
}

export const prints = (from, count) => Array.from({ length: count }, (_, k) => print(from + k));
