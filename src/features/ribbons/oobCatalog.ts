import { RibbonScope } from "./models";

export interface OobRibbonLocation {
  id: string;
  scope: RibbonScope;
  label: string;
  location: string;
  group: string;
}

export interface OobRibbonCommand {
  id: string;
  label: string;
  scopes: RibbonScope[];
  locationIds: string[];
}

interface OobRibbonLocationTemplate {
  id: string;
  scope: RibbonScope;
  label: string;
  locationTemplate: string;
  group: string;
}

interface OobRibbonCommandTemplate {
  idTemplate: string;
  label: string;
  scopes: RibbonScope[];
  locationIds: string[];
}

const LOCATION_TEMPLATES: OobRibbonLocationTemplate[] = [
  {
    id: "form-save",
    scope: "Form",
    label: "Form Save",
    group: "Save",
    locationTemplate: "Mscrm.Form.{entity}.MainTab.Save.Controls._children",
  },
  {
    id: "form-collaborate",
    scope: "Form",
    label: "Form Collaborate",
    group: "Collaborate",
    locationTemplate: "Mscrm.Form.{entity}.MainTab.Collaborate.Controls._children",
  },
  {
    id: "form-process",
    scope: "Form",
    label: "Form Process",
    group: "Process",
    locationTemplate: "Mscrm.Form.{entity}.MainTab.Process.Controls._children",
  },
  {
    id: "form-record",
    scope: "Form",
    label: "Form Record",
    group: "Record",
    locationTemplate: "Mscrm.Form.{entity}.MainTab.Record.Controls._children",
  },
  {
    id: "form-navigation",
    scope: "Form",
    label: "Form Navigation",
    group: "Navigation",
    locationTemplate: "Mscrm.Form.{entity}.MainTab.Navigation.Controls._children",
  },
  {
    id: "homepagegrid-management",
    scope: "HomepageGrid",
    label: "Grid Management",
    group: "Management",
    locationTemplate: "Mscrm.HomepageGrid.{entity}.MainTab.Management.Controls._children",
  },
  {
    id: "homepagegrid-records",
    scope: "HomepageGrid",
    label: "Grid Records",
    group: "Records",
    locationTemplate: "Mscrm.HomepageGrid.{entity}.MainTab.Records.Controls._children",
  },
  {
    id: "homepagegrid-actions",
    scope: "HomepageGrid",
    label: "Grid Actions",
    group: "Actions",
    locationTemplate: "Mscrm.HomepageGrid.{entity}.MainTab.Actions.Controls._children",
  },
  {
    id: "homepagegrid-view",
    scope: "HomepageGrid",
    label: "Grid View",
    group: "View",
    locationTemplate: "Mscrm.HomepageGrid.{entity}.MainTab.View.Controls._children",
  },
  {
    id: "homepagegrid-data",
    scope: "HomepageGrid",
    label: "Grid Data",
    group: "Data",
    locationTemplate: "Mscrm.HomepageGrid.{entity}.MainTab.Data.Controls._children",
  },
  {
    id: "subgrid-standard",
    scope: "SubGrid",
    label: "Subgrid Standard",
    group: "Standard",
    locationTemplate: "Mscrm.SubGrid.{entity}.MainTab.Standard.Controls._children",
  },
  {
    id: "subgrid-actions",
    scope: "SubGrid",
    label: "Subgrid Actions",
    group: "Actions",
    locationTemplate: "Mscrm.SubGrid.{entity}.MainTab.Actions.Controls._children",
  },
  {
    id: "subgrid-management",
    scope: "SubGrid",
    label: "Subgrid Management",
    group: "Management",
    locationTemplate: "Mscrm.SubGrid.{entity}.MainTab.Management.Controls._children",
  },
];

const COMMAND_TEMPLATES: OobRibbonCommandTemplate[] = [
  {
    idTemplate: "Mscrm.SavePrimary",
    label: "Save",
    scopes: ["Form"],
    locationIds: ["form-save"],
  },
  {
    idTemplate: "Mscrm.SaveAndClosePrimary",
    label: "Save and close",
    scopes: ["Form"],
    locationIds: ["form-save"],
  },
  {
    idTemplate: "Mscrm.SaveAndNewPrimary",
    label: "Save and new",
    scopes: ["Form"],
    locationIds: ["form-save"],
  },
  {
    idTemplate: "Mscrm.DeletePrimary",
    label: "Delete",
    scopes: ["Form"],
    locationIds: ["form-record"],
  },
  {
    idTemplate: "Mscrm.AssignPrimaryRecord",
    label: "Assign",
    scopes: ["Form"],
    locationIds: ["form-record"],
  },
  {
    idTemplate: "Mscrm.SharePrimaryRecord",
    label: "Share",
    scopes: ["Form"],
    locationIds: ["form-collaborate"],
  },
  {
    idTemplate: "Mscrm.EmailLinkPrimary",
    label: "Email link",
    scopes: ["Form"],
    locationIds: ["form-collaborate"],
  },
  {
    idTemplate: "Mscrm.RefreshForm",
    label: "Refresh",
    scopes: ["Form"],
    locationIds: ["form-navigation"],
  },
  {
    idTemplate: "Mscrm.AddNewRecordFromForm",
    label: "New",
    scopes: ["Form"],
    locationIds: ["form-record"],
  },
  {
    idTemplate: "Mscrm.ActivatePrimaryRecord",
    label: "Activate",
    scopes: ["Form"],
    locationIds: ["form-record"],
  },
  {
    idTemplate: "Mscrm.DeactivatePrimaryRecord",
    label: "Deactivate",
    scopes: ["Form"],
    locationIds: ["form-record"],
  },
  {
    idTemplate: "Mscrm.RunReportPrimary",
    label: "Run report",
    scopes: ["Form"],
    locationIds: ["form-process"],
  },
  {
    idTemplate: "Mscrm.HomepageGrid.{entity}.AddNewRecord",
    label: "New",
    scopes: ["HomepageGrid"],
    locationIds: ["homepagegrid-management"],
  },
  {
    idTemplate: "Mscrm.HomepageGrid.{entity}.Edit",
    label: "Edit",
    scopes: ["HomepageGrid"],
    locationIds: ["homepagegrid-records"],
  },
  {
    idTemplate: "Mscrm.HomepageGrid.{entity}.DeleteMenu",
    label: "Delete",
    scopes: ["HomepageGrid"],
    locationIds: ["homepagegrid-records"],
  },
  {
    idTemplate: "Mscrm.HomepageGrid.{entity}.Assign",
    label: "Assign",
    scopes: ["HomepageGrid"],
    locationIds: ["homepagegrid-actions"],
  },
  {
    idTemplate: "Mscrm.HomepageGrid.{entity}.Share",
    label: "Share",
    scopes: ["HomepageGrid"],
    locationIds: ["homepagegrid-actions"],
  },
  {
    idTemplate: "Mscrm.HomepageGrid.{entity}.Refresh",
    label: "Refresh",
    scopes: ["HomepageGrid"],
    locationIds: ["homepagegrid-view"],
  },
  {
    idTemplate: "Mscrm.HomepageGrid.{entity}.ExportToExcel",
    label: "Export to Excel",
    scopes: ["HomepageGrid"],
    locationIds: ["homepagegrid-data"],
  },
  {
    idTemplate: "Mscrm.SubGrid.{entity}.AddNewStandard",
    label: "Add new",
    scopes: ["SubGrid"],
    locationIds: ["subgrid-standard"],
  },
  {
    idTemplate: "Mscrm.SubGrid.{entity}.AddExistingStandard",
    label: "Add existing",
    scopes: ["SubGrid"],
    locationIds: ["subgrid-standard"],
  },
  {
    idTemplate: "Mscrm.SubGrid.{entity}.Edit",
    label: "Edit",
    scopes: ["SubGrid"],
    locationIds: ["subgrid-actions"],
  },
  {
    idTemplate: "Mscrm.SubGrid.{entity}.Delete",
    label: "Remove",
    scopes: ["SubGrid"],
    locationIds: ["subgrid-actions"],
  },
  {
    idTemplate: "Mscrm.SubGrid.{entity}.Refresh",
    label: "Refresh",
    scopes: ["SubGrid"],
    locationIds: ["subgrid-management"],
  },
];

export function listOobRibbonLocations(
  scope?: RibbonScope,
  entityLogicalName = "{entity}",
): OobRibbonLocation[] {
  return LOCATION_TEMPLATES.filter((location) => !scope || location.scope === scope).map(
    (location) => ({
      id: location.id,
      scope: location.scope,
      label: location.label,
      group: location.group,
      location: applyEntity(location.locationTemplate, entityLogicalName),
    }),
  );
}

export function listOobRibbonCommands(
  scope?: RibbonScope,
  entityLogicalName = "{entity}",
): OobRibbonCommand[] {
  return COMMAND_TEMPLATES.filter((command) => !scope || command.scopes.includes(scope)).map(
    (command) => ({
      id: applyEntity(command.idTemplate, entityLogicalName),
      label: command.label,
      scopes: command.scopes,
      locationIds: command.locationIds,
    }),
  );
}

export function findOobRibbonLocation(
  id: string,
  entityLogicalName = "{entity}",
): OobRibbonLocation | undefined {
  return listOobRibbonLocations(undefined, entityLogicalName).find(
    (location) => location.id === id,
  );
}

export function findOobRibbonCommand(
  id: string,
  entityLogicalName = "{entity}",
): OobRibbonCommand | undefined {
  return listOobRibbonCommands(undefined, entityLogicalName).find((command) => command.id === id);
}

function applyEntity(value: string, entityLogicalName: string): string {
  return value.replace(/\{entity\}/g, entityLogicalName);
}
