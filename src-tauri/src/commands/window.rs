//! Closing the window, by any route: the custom button, the OS shortcut
//! or the window manager. Drafts live only in the frontend, so it tells
//! this side when they exist; closing with drafts stops here and the UI
//! decides. After "Save all" or "Close without saving" one close passes
//! the drafts check, and the running-terminals check still applies.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::State;

#[derive(Debug, PartialEq, Eq)]
pub enum CloseDecision {
    Proceed,
    AskDrafts,
    AskTerminals,
}

#[derive(Default)]
pub struct CloseGuard {
    unsaved: AtomicBool,
    pass_once: AtomicBool,
}

impl CloseGuard {
    /// One decision per close request; a pass is spent even if unused.
    pub fn decide(&self, running_terminals: usize) -> CloseDecision {
        let pass = self.pass_once.swap(false, Ordering::SeqCst);
        if !pass && self.unsaved.load(Ordering::SeqCst) {
            CloseDecision::AskDrafts
        } else if running_terminals > 0 {
            CloseDecision::AskTerminals
        } else {
            CloseDecision::Proceed
        }
    }
}

#[tauri::command]
pub fn app_set_unsaved_drafts(guard: State<CloseGuard>, unsaved: bool) {
    guard.unsaved.store(unsaved, Ordering::SeqCst);
}

/// The person already chose: the next close skips the drafts check.
#[tauri::command]
pub fn app_allow_close_once(guard: State<CloseGuard>) {
    guard.pass_once.store(true, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn guard(unsaved: bool, pass_once: bool) -> CloseGuard {
        CloseGuard {
            unsaved: AtomicBool::new(unsaved),
            pass_once: AtomicBool::new(pass_once),
        }
    }

    #[test]
    fn closes_when_nothing_is_at_stake() {
        assert_eq!(guard(false, false).decide(0), CloseDecision::Proceed);
    }

    #[test]
    fn drafts_stop_any_close_before_terminals() {
        assert_eq!(guard(true, false).decide(0), CloseDecision::AskDrafts);
        assert_eq!(guard(true, false).decide(2), CloseDecision::AskDrafts);
    }

    #[test]
    fn a_pass_skips_drafts_but_not_terminals() {
        assert_eq!(guard(true, true).decide(0), CloseDecision::Proceed);
        assert_eq!(guard(true, true).decide(2), CloseDecision::AskTerminals);
    }

    #[test]
    fn a_pass_works_once_so_a_cancelled_close_stays_protected() {
        let guard = guard(true, true);
        assert_eq!(guard.decide(2), CloseDecision::AskTerminals);
        assert_eq!(guard.decide(0), CloseDecision::AskDrafts);
    }
}
