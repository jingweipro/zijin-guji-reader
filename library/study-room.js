// Local capabilities and book activity for the reader. The backing store owns all persistence.
const GujiStudyRoom = {
  local(store, currentState) {
    const exportBackup = () => store.exportData(currentState());
    return Object.freeze({
      userId: null,
      membership: Object.freeze({status: 'free', expiresAt: null}),
      sync: Object.freeze({enabled: false, lastSyncedAt: null}),
      freeExportsRemaining: null,
      exportBackup,
      bookActivity(bookId) {
        const {state} = JSON.parse(exportBackup());
        const inBook = records => (records ?? []).filter(record => record.book === bookId);
        return {
          bookId,
          progress: Object.hasOwn(state.places ?? {}, bookId) ? state.places[bookId] : null,
          bookmarks: inBook(state.studyBookmarks),
          highlights: inBook(state.studyLines),
          notes: inBook(state.notes)
        };
      }
    });
  }
};
