import type { Metadata } from 'next';
import LightsOutClient from './_lights-out-client';

export const metadata: Metadata = {
  title: 'Lights Out | tixy',
  description: 'Switch every light off in a small puzzle.',
};

export default function LightsOutPage() {
  return <LightsOutClient />;
}
