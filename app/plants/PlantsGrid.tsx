'use client';

import { useState } from 'react';
import type { Plant } from './page';

const DARK_OVERLAY =
  'linear-gradient(180deg, rgba(7,25,18,0.35) 0%, transparent 35%, transparent 55%, rgba(7,25,18,0.72) 100%)';

const difficultyColor: Record<Plant['difficulty'], string> = {
  Easy: '#6FAE8E',
  Medium: '#CFC7B4',
  Hard: '#EDE7D9',
};

function PlantCard({ plant }: { plant: Plant }) {
  const [imgError, setImgError] = useState(false);

  return (
    <div
      className="flex flex-col rounded-md overflow-hidden transition-colors"
      style={{
        backgroundColor: '#0F2A20',
        border: '1px solid rgba(111, 122, 110, 0.4)',
      }}
    >
      <div className="relative w-full h-44 overflow-hidden" style={{ backgroundColor: '#071912' }}>
        {imgError ? (
          <div className="w-full h-full flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #0F2A20, #1E3A2E)' }}>
            <span className="text-5xl font-bold" style={{ color: '#3A6B50' }}>{plant.name[0]}</span>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={plant.image}
            alt={plant.name}
            width={480}
            height={320}
            className="w-full h-full object-cover"
            style={{ filter: 'brightness(0.88) saturate(1.1)' }}
            onError={() => setImgError(true)}
          />
        )}
        {/* Unified dark-aquarium overlay for all images */}
        <div className="absolute inset-0 pointer-events-none" style={{ background: DARK_OVERLAY }} />
      </div>
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <span className="font-semibold" style={{ color: '#EDE7D9' }}>
            {plant.name}
          </span>
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium"
            style={{
              backgroundColor: 'rgba(111, 122, 110, 0.2)',
              color: difficultyColor[plant.difficulty],
            }}
          >
            {plant.difficulty}
          </span>
        </div>
        <span className="text-sm italic" style={{ color: '#CFC7B4' }}>
          {plant.scientificName}
        </span>
        <div className="mt-1 flex flex-wrap gap-2 text-xs" style={{ color: '#6FAE8E' }}>
          <span>{plant.type}</span>
          <span>·</span>
          <span>{plant.lightRequirement} light</span>
          <span>·</span>
          <span>{plant.co2Required ? 'CO₂ required' : 'No CO₂'}</span>
        </div>
      </div>
    </div>
  );
}

export function PlantsGrid({ plants }: { plants: Plant[] }) {
  const [query, setQuery] = useState('');

  // English-only search: common name, scientific name, id
  const q = query.trim().toLowerCase();
  const filtered = q
    ? plants.filter((p) => [p.name, p.scientificName, p.id].some((f) => f.toLowerCase().includes(q)))
    : plants;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <input
          type="search"
          placeholder="Search plants..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-md px-4 py-2 text-sm outline-none transition-colors"
          style={{
            backgroundColor: '#0F2A20',
            border: '1px solid rgba(111, 122, 110, 0.4)',
            color: '#EDE7D9',
          }}
        />
      </div>

      <p className="text-sm" style={{ color: '#CFC7B4' }}>
        {filtered.length} of {plants.length} species
      </p>

      {filtered.length === 0 ? (
        <p style={{ color: '#CFC7B4' }}>No plants match &ldquo;{query}&rdquo;.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((plant) => (
            <PlantCard key={plant.id} plant={plant} />
          ))}
        </div>
      )}
    </div>
  );
}
