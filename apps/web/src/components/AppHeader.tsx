import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { LANGUAGE_OPTIONS, type FrontendI18n } from '../lib/i18n.js';
import type { UserPreferences } from '../hooks/useLocalPrefs.js';

interface AppHeaderProps {
  i18n: FrontendI18n;
  puzzleCountText: string;
  headerLanguageRef: MutableRefObject<HTMLDetailsElement | null>;
  headerSettingsRef: MutableRefObject<HTMLDetailsElement | null>;
  closeHeaderMenus: (keepOpen?: 'settings' | 'language' | null) => void;
  prefs: UserPreferences;
  setPrefs: Dispatch<SetStateAction<UserPreferences>>;
  toggleVariationMode: (checked: boolean) => void;
  puzzleIdInput: string;
  setPuzzleIdInput: Dispatch<SetStateAction<string>>;
  handleLoadById: () => Promise<void>;
  loading: boolean;
  historyLoading: boolean;
}

function ToggleChip(props: {
  active: boolean;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  const { active, label, onClick, className } = props;

  return (
    <button
      type="button"
      className={`toggle-chip ${className ?? ''} ${active ? 'is-on' : 'is-off'}`.trim()}
      aria-pressed={active}
      onClick={onClick}
    >
      <span className="toggle-chip-text">{label}</span>
      <span className="toggle-chip-track" aria-hidden="true">
        <span className="toggle-chip-thumb" />
      </span>
    </button>
  );
}

export function AppHeader(props: AppHeaderProps) {
  const {
    i18n,
    puzzleCountText,
    headerLanguageRef,
    headerSettingsRef,
    closeHeaderMenus,
    prefs,
    setPrefs,
    toggleVariationMode,
    puzzleIdInput,
    setPuzzleIdInput,
    handleLoadById,
    loading,
    historyLoading
  } = props;

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="app-header-primary">
          <div className="app-brand-lockup">
            <a className="app-brand" href="/" aria-label={i18n.homeAriaLabel}>
              chess-web
            </a>
            <p className="app-brand-meta">{puzzleCountText}</p>
          </div>
          <div className="app-header-controls">
            <details
              ref={headerLanguageRef}
              className="app-header-settings app-header-language settings-panel"
              onToggle={(event) => {
                if (event.currentTarget.open) {
                  closeHeaderMenus('language');
                }
              }}
            >
              <summary className="settings-summary">{i18n.languageLabel}</summary>
              <div className="settings-content">
                <div className="settings-content-body">
                  <section className="settings-section settings-section-language" aria-labelledby="settings-language">
                    <div className="settings-section-head">
                      <span className="settings-section-title" id="settings-language">
                        {i18n.languageLabel}
                      </span>
                    </div>
                    <div className="language-option-grid" role="group" aria-label={i18n.languageLabel}>
                      {LANGUAGE_OPTIONS.map((option) => (
                        <button
                          key={option.code}
                          type="button"
                          className={`language-option ${prefs.language === option.code ? 'is-active' : ''}`}
                          aria-pressed={prefs.language === option.code}
                          onClick={() => {
                            setPrefs((previous) => ({
                              ...previous,
                              language: option.code
                            }));
                            if (headerLanguageRef.current) {
                              headerLanguageRef.current.open = false;
                            }
                          }}
                        >
                          <span className="language-option-english">{option.englishLabel}</span>
                          <span className="language-option-native">{option.nativeLabel}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                </div>
              </div>
            </details>

            <details
              ref={headerSettingsRef}
              className="app-header-settings settings-panel"
              onToggle={(event) => {
                if (event.currentTarget.open) {
                  closeHeaderMenus('settings');
                }
              }}
            >
              <summary className="settings-summary">{i18n.settings}</summary>
              <div className="settings-content">
                <div className="settings-content-body">
                  <section className="settings-section" aria-labelledby="settings-gameplay">
                    <div className="settings-section-head">
                      <span className="settings-section-title" id="settings-gameplay">
                        {i18n.gameplay}
                      </span>
                    </div>
                    <div className="toggle-chip-grid">
                      <ToggleChip
                        active={prefs.variationMode === 'explore'}
                        label={i18n.exploreVariations}
                        onClick={() => toggleVariationMode(prefs.variationMode !== 'explore')}
                      />
                      <ToggleChip
                        active={prefs.skipSimilarVariations}
                        label={i18n.skipSimilarVariations}
                        onClick={() =>
                          setPrefs((previous) => ({
                            ...previous,
                            skipSimilarVariations: !previous.skipSimilarVariations
                          }))
                        }
                      />
                      <ToggleChip
                        active={prefs.autoNext}
                        label={i18n.autoNextPuzzle}
                        onClick={() =>
                          setPrefs((previous) => ({
                            ...previous,
                            autoNext: !previous.autoNext
                          }))
                        }
                      />
                      <ToggleChip
                        active={prefs.hintsEnabled}
                        label={i18n.enableHints}
                        onClick={() =>
                          setPrefs((previous) => ({
                            ...previous,
                            hintsEnabled: !previous.hintsEnabled
                          }))
                        }
                      />
                      <ToggleChip
                        active={prefs.oneTryMode}
                        label={i18n.oneTryMode}
                        onClick={() =>
                          setPrefs((previous) => ({
                            ...previous,
                            oneTryMode: !previous.oneTryMode
                          }))
                        }
                      />
                    </div>
                  </section>

                  <section className="settings-section" aria-labelledby="settings-presentation">
                    <div className="settings-section-head">
                      <span className="settings-section-title" id="settings-presentation">
                        {i18n.display}
                      </span>
                    </div>
                    <div className="toggle-chip-grid">
                      <ToggleChip
                        active={prefs.darkMode}
                        label={i18n.darkMode}
                        onClick={() =>
                          setPrefs((previous) => ({
                            ...previous,
                            darkMode: !previous.darkMode
                          }))
                        }
                      />
                      <ToggleChip
                        active={prefs.zenMode}
                        label={i18n.zenMode}
                        onClick={() =>
                          setPrefs((previous) => ({
                            ...previous,
                            zenMode: !previous.zenMode
                          }))
                        }
                      />
                      <ToggleChip
                        active={prefs.boardGlass}
                        label={i18n.boardGlass}
                        onClick={() =>
                          setPrefs((previous) => ({
                            ...previous,
                            boardGlass: !previous.boardGlass
                          }))
                        }
                      />
                      <ToggleChip
                        active={prefs.showEngineEval}
                        label={i18n.engineEval}
                        onClick={() =>
                          setPrefs((previous) => ({
                            ...previous,
                            showEngineEval: !previous.showEngineEval
                          }))
                        }
                      />
                    </div>
                  </section>

                  <section className="settings-section" aria-labelledby="settings-feedback">
                    <div className="settings-section-head">
                      <span className="settings-section-title" id="settings-feedback">
                        {i18n.feedback}
                      </span>
                    </div>
                    <div className="toggle-chip-grid">
                      <ToggleChip
                        active={prefs.animations}
                        label={i18n.animations}
                        onClick={() =>
                          setPrefs((previous) => ({
                            ...previous,
                            animations: !previous.animations
                          }))
                        }
                      />
                      <ToggleChip
                        active={prefs.soundEnabled}
                        label={i18n.sound}
                        onClick={() =>
                          setPrefs((previous) => ({
                            ...previous,
                            soundEnabled: !previous.soundEnabled
                          }))
                        }
                      />
                      <ToggleChip
                        active={prefs.captureRain}
                        label={i18n.captureRain}
                        onClick={() =>
                          setPrefs((previous) => ({
                            ...previous,
                            captureRain: !previous.captureRain
                          }))
                        }
                      />
                    </div>
                  </section>

                  <section className="settings-section" aria-labelledby="settings-automation">
                    <div className="settings-section-head">
                      <span className="settings-section-title" id="settings-automation">
                        {i18n.automation}
                      </span>
                    </div>
                    <div className="toggle-chip-grid">
                      <ToggleChip
                        active={prefs.autoPlay}
                        label={i18n.autoplayPuzzles}
                        className="autoplay-chip"
                        onClick={() =>
                          setPrefs((previous) => ({
                            ...previous,
                            autoPlay: !previous.autoPlay
                          }))
                        }
                      />
                      <ToggleChip
                        active={prefs.autoQueenPromotion}
                        label={i18n.autoQueen}
                        onClick={() =>
                          setPrefs((previous) => ({
                            ...previous,
                            autoQueenPromotion: !previous.autoQueenPromotion
                          }))
                        }
                      />
                    </div>
                  </section>

                  <section className="settings-section" aria-labelledby="settings-tools">
                    <div className="settings-section-head">
                      <span className="settings-section-title" id="settings-tools">
                        {i18n.tools}
                      </span>
                    </div>
                    <div className="id-search-row">
                      <input
                        type="text"
                        value={puzzleIdInput}
                        onChange={(event) => setPuzzleIdInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void handleLoadById();
                          }
                        }}
                        placeholder={i18n.puzzleIdPlaceholder}
                        spellCheck={false}
                      />
                      <button
                        type="button"
                        disabled={loading || historyLoading || puzzleIdInput.trim().length === 0}
                        onClick={() => void handleLoadById()}
                      >
                        {i18n.loadId}
                      </button>
                    </div>
                  </section>
                </div>
              </div>
            </details>
          </div>
        </div>
      </div>
    </header>
  );
}
