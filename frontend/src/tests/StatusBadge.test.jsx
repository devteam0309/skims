import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBadge from '../components/shared/StatusBadge';

describe('StatusBadge', () => {
  it('renders a known status with its styled classes', () => {
    render(<StatusBadge status="approved" />);
    const badge = screen.getByText('Approved');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toMatch(/bg-green-100/);
  });

  it('uses the explicit label override for compound statuses', () => {
    render(<StatusBadge status="pending_approval" />);
    expect(screen.getByText('Pending Approval')).toBeInTheDocument();
  });

  it('title-cases an unknown status by replacing underscores', () => {
    render(<StatusBadge status="some_custom_state" />);
    expect(screen.getByText('Some Custom State')).toBeInTheDocument();
  });

  it('applies a neutral fallback style for unknown statuses', () => {
    render(<StatusBadge status="whatever" />);
    expect(screen.getByText('Whatever').className).toMatch(/bg-gray-100/);
  });

  it('merges a custom className', () => {
    render(<StatusBadge status="ongoing" className="extra-class" />);
    expect(screen.getByText('Ongoing').className).toMatch(/extra-class/);
  });
});
