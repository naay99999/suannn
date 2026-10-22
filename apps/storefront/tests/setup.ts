import { GlobalRegistrator } from '@happy-dom/global-registrator'

GlobalRegistrator.register()

// Injected third-party <script> tags (tracking pixels) must not be fetched or raise errors under test.
window.happyDOM.settings.handleDisabledFileLoadingAsSuccess = true
