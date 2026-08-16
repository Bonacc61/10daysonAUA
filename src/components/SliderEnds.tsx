import type { CSSProperties } from 'react';
import { Shades, Parachute, Spark, MoneyBag } from './Icons';

// The labels at the two ends of the Vibe and Price sliders. They live here
// rather than in the pages because Explore and Dashboard both render those
// sliders — one home means the two cannot drift into saying it differently.

const END: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5 };
// Sized in em, not px: Explore sets these labels at 11px and Dashboard at 10px,
// and a single px size that suits one looks oversized beside the other.
const SIZE = { width: '1.45em', height: '1.45em' };
// Only the parachute's shrouds are stroked; the rest of each mark is filled.
const SW = 1.9;

// aria-hidden throughout: the word beside each mark already says it, and the
// slider itself carries the aria-label.
export const ChillEnd      = () => <span style={END}><Shades {...SIZE} aria-hidden /> Chill</span>;
export const AdrenalineEnd = () => <span style={END}>Adrenaline <Parachute {...SIZE} sw={SW} aria-hidden /></span>;
export const FreeEnd       = () => <span style={END}><Spark {...SIZE} aria-hidden /> Free</span>;
export const SplurgeEnd    = () => <span style={END}>Splurge <MoneyBag {...SIZE} aria-hidden /></span>;
