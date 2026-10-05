// The license state machine lives in @o-okul/db so the purge worker and the API share one rule.
export { licenseStates, resolveLicenseState, type LicenseState, type LicenseTermWindow } from "@o-okul/db";
