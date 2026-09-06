import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import LandingPage from '../pages/LandingPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
}

describe('landing page', () => {
  it('leads with the promise, not with the sign-in form', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: /still know it/i })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('asks for the same thing everywhere it asks', () => {
    renderPage();
    // One call to action, in one set of words. Three different asks read as
    // three different offers.
    const cta = screen.getAllByRole('link', { name: /take one of the ten places/i });
    expect(cta.length).toBeGreaterThan(1);
    for (const link of cta) expect(link).toHaveAttribute('href', '/signin');
  });

  /**
   * The honesty requirements from T-101. These are not decoration: a
   * participant who feels tricked on day 30 is a participant who drops out, and
   * a dropout costs a tenth of the result. If someone deletes one of these
   * lines to make the page read better, that is a decision to make on purpose.
   */
  describe('says the uncomfortable parts out loud', () => {
    it('admits free-text topics are not open yet', () => {
      renderPage();
      expect(screen.getByText(/your own topics aren’t open yet/i)).toBeInTheDocument();
    });

    it('warns that the test is unannounced', () => {
      renderPage();
      expect(screen.getByText(/unannounced, on day 30/i)).toBeInTheDocument();
    });

    it('admits that some concepts are deliberately never taught', () => {
      renderPage();
      expect(screen.getByText(/one concept in ten is held back/i)).toBeInTheDocument();
    });

    it('does not claim a result it does not have', () => {
      renderPage();
      expect(screen.getByText(/i don’t know yet whether this works/i)).toBeInTheDocument();
    });
  });

  describe('the sample question', () => {
    it('waits for an attempt before showing anything', () => {
      renderPage();
      expect(screen.queryByText(/^Right\.$/)).not.toBeInTheDocument();
      expect(screen.getByText(/have a go/i)).toBeInTheDocument();
    });

    it('confirms a correct answer and explains why', async () => {
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole('radio', { name: /shrink it from the left/i }));

      expect(screen.getByText(/^Right\.$/)).toBeInTheDocument();
      expect(screen.getByText(/the invariant is/i)).toBeInTheDocument();
    });

    it('marks a wrong answer wrong, and still explains', async () => {
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole('radio', { name: /reset both pointers/i }));

      expect(screen.getByText(/not this time/i)).toBeInTheDocument();
      // The explanation is the point of getting it wrong, so it appears either way.
      expect(screen.getByText(/the invariant is/i)).toBeInTheDocument();
    });
  });
});
