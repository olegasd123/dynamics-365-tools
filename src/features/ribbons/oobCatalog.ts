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
  commandId: string;
  controlId?: string;
  sequence?: number;
  image16x16?: string;
  image32x32?: string;
  templateAlias?: string;
}

interface OobRibbonLocationTemplate {
  id: string;
  scope: RibbonScope;
  label: string;
  locationTemplate: string;
  group: string;
}

interface OobRibbonCommandTemplate {
  commandIdTemplate: string;
  controlIdTemplate?: string;
  idTemplate?: string;
  label: string;
  scopes: RibbonScope[];
  locationIds: string[];
  sequence?: number;
  image16x16?: string;
  image32x32?: string;
  templateAlias?: string;
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
    id: "form-actions",
    scope: "Form",
    label: "Form Actions",
    group: "Actions",
    locationTemplate: "Mscrm.Form.{entity}.MainTab.Actions.Controls._children",
  },
  {
    id: "form-data",
    scope: "Form",
    label: "Form Data",
    group: "Data",
    locationTemplate: "Mscrm.Form.{entity}.MainTab.Data.Controls._children",
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
    id: "homepagegrid-collaborate",
    scope: "HomepageGrid",
    label: "Grid Collaborate",
    group: "Collaborate",
    locationTemplate: "Mscrm.HomepageGrid.{entity}.MainTab.Collaborate.Controls._children",
  },
  {
    id: "homepagegrid-process",
    scope: "HomepageGrid",
    label: "Grid Process",
    group: "Process",
    locationTemplate: "Mscrm.HomepageGrid.{entity}.MainTab.Process.Controls._children",
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
    id: "homepagegrid-import",
    scope: "HomepageGrid",
    label: "Grid Import",
    group: "Import",
    locationTemplate: "Mscrm.HomepageGrid.{entity}.MainTab.Import.Controls._children",
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
    commandIdTemplate: "Mscrm.SavePrimary",
    controlIdTemplate: "Mscrm.Form.{entity}.Save",
    label: "Save",
    scopes: ["Form"],
    locationIds: ["form-save"],
    sequence: 10,
    image16x16: "/_imgs/ribbon/Save_16.png",
    image32x32: "/_imgs/ribbon/Save_32.png",
    templateAlias: "o1",
  },
  {
    commandIdTemplate: "Mscrm.SaveAndClosePrimary",
    controlIdTemplate: "Mscrm.Form.{entity}.SaveAndClose",
    label: "Save and close",
    scopes: ["Form"],
    locationIds: ["form-save"],
    sequence: 20,
    image16x16: "/_imgs/ribbon/SaveAndClose_16.png",
    image32x32: "/_imgs/ribbon/SaveAndClose_32.png",
    templateAlias: "o1",
  },
  {
    commandIdTemplate: "Mscrm.SaveAndNewPrimary",
    controlIdTemplate: "Mscrm.Form.{entity}.SaveAndNew",
    label: "Save and new",
    scopes: ["Form"],
    locationIds: ["form-save"],
    sequence: 30,
    image16x16: "/_imgs/ribbon/SaveAndNew_16.png",
    image32x32: "/_imgs/ribbon/SaveAndNew_32.png",
    templateAlias: "o1",
  },
  {
    commandIdTemplate: "Mscrm.DeletePrimary",
    controlIdTemplate: "Mscrm.Form.{entity}.Delete",
    label: "Delete",
    scopes: ["Form"],
    locationIds: ["form-record"],
    sequence: 40,
    image16x16: "/_imgs/ribbon/Delete_16.png",
    image32x32: "/_imgs/Workplace/remove_32.png",
    templateAlias: "o1",
  },
  {
    commandIdTemplate: "Mscrm.AssignPrimaryRecord",
    controlIdTemplate: "Mscrm.Form.{entity}.Assign",
    label: "Assign",
    scopes: ["Form"],
    locationIds: ["form-record"],
    sequence: 50,
  },
  {
    commandIdTemplate: "Mscrm.SharePrimaryRecord",
    controlIdTemplate: "Mscrm.Form.{entity}.Share",
    label: "Share",
    scopes: ["Form"],
    locationIds: ["form-collaborate"],
    sequence: 10,
  },
  {
    commandIdTemplate: "Mscrm.EmailLinkPrimary",
    controlIdTemplate: "Mscrm.Form.{entity}.EmailLink",
    label: "Email link",
    scopes: ["Form"],
    locationIds: ["form-collaborate"],
    sequence: 20,
    image16x16: "/_imgs/ribbon/EmailLink_16.png",
    image32x32: "/_imgs/ribbon/SendShortcut_32.png",
  },
  {
    commandIdTemplate: "Mscrm.CopyShortcutPrimary",
    controlIdTemplate: "Mscrm.Form.{entity}.CopyShortcut",
    label: "Copy link",
    scopes: ["Form"],
    locationIds: ["form-collaborate"],
    sequence: 30,
  },
  {
    commandIdTemplate: "Mscrm.RefreshForm",
    controlIdTemplate: "Mscrm.Form.{entity}.Refresh",
    label: "Refresh",
    scopes: ["Form"],
    locationIds: ["form-navigation"],
    sequence: 10,
  },
  {
    commandIdTemplate: "Mscrm.AddNewRecordFromForm",
    controlIdTemplate: "Mscrm.Form.{entity}.NewRecord",
    label: "New",
    scopes: ["Form"],
    locationIds: ["form-record"],
    sequence: 10,
    image16x16: "/_imgs/ribbon/New_16.png",
    image32x32: "/_imgs/ribbon/newrecord32.png",
    templateAlias: "o1",
  },
  {
    commandIdTemplate: "Mscrm.ActivatePrimaryRecord",
    controlIdTemplate: "Mscrm.Form.{entity}.Activate",
    label: "Activate",
    scopes: ["Form"],
    locationIds: ["form-record"],
    sequence: 60,
  },
  {
    commandIdTemplate: "Mscrm.DeactivatePrimaryRecord",
    controlIdTemplate: "Mscrm.Form.{entity}.Deactivate",
    label: "Deactivate",
    scopes: ["Form"],
    locationIds: ["form-record"],
    sequence: 70,
  },
  {
    commandIdTemplate: "Mscrm.RunReportPrimary",
    controlIdTemplate: "Mscrm.Form.{entity}.RunReport",
    label: "Run report",
    scopes: ["Form"],
    locationIds: ["form-process"],
    sequence: 10,
  },
  {
    commandIdTemplate: "Mscrm.RunWorkflowPrimary",
    controlIdTemplate: "Mscrm.Form.{entity}.RunWorkflow",
    label: "Run workflow",
    scopes: ["Form"],
    locationIds: ["form-process"],
    sequence: 20,
  },
  {
    commandIdTemplate: "Mscrm.AddConnectionPrimary",
    controlIdTemplate: "Mscrm.Form.{entity}.AddConnection",
    label: "Connect",
    scopes: ["Form"],
    locationIds: ["form-actions"],
    sequence: 10,
  },
  {
    commandIdTemplate: "Mscrm.NewRecordFromGrid",
    controlIdTemplate: "Mscrm.HomepageGrid.{entity}.NewRecord",
    idTemplate: "Mscrm.HomepageGrid.{entity}.NewRecord",
    label: "New",
    scopes: ["HomepageGrid"],
    locationIds: ["homepagegrid-management"],
    sequence: 10,
    image16x16: "/_imgs/ribbon/New_16.png",
    image32x32: "/_imgs/ribbon/newrecord32.png",
    templateAlias: "o1",
  },
  {
    commandIdTemplate: "Mscrm.HomepageGrid.{entity}.AddNewRecord",
    controlIdTemplate: "Mscrm.HomepageGrid.{entity}.AddNewRecord",
    label: "New (legacy)",
    scopes: ["HomepageGrid"],
    locationIds: ["homepagegrid-management"],
  },
  {
    commandIdTemplate: "Mscrm.EditSelectedRecord",
    controlIdTemplate: "Mscrm.HomepageGrid.{entity}.Edit",
    idTemplate: "Mscrm.HomepageGrid.{entity}.Edit",
    label: "Edit",
    scopes: ["HomepageGrid"],
    locationIds: ["homepagegrid-records"],
    sequence: 20,
    image16x16: "/_imgs/ribbon/Edit_16.png",
    image32x32: "/_imgs/ribbon/edit32.png",
    templateAlias: "o1",
  },
  {
    commandIdTemplate: "Mscrm.DeleteSelectedRecord",
    controlIdTemplate: "Mscrm.HomepageGrid.{entity}.Delete",
    idTemplate: "Mscrm.HomepageGrid.{entity}.Delete",
    label: "Delete",
    scopes: ["HomepageGrid"],
    locationIds: ["homepagegrid-records"],
    sequence: 50,
    image16x16: "/_imgs/ribbon/Delete_16.png",
    image32x32: "/_imgs/Workplace/remove_32.png",
  },
  {
    commandIdTemplate: "Mscrm.DeleteSelectedRecord",
    controlIdTemplate: "Mscrm.HomepageGrid.{entity}.DeleteMenu",
    idTemplate: "Mscrm.HomepageGrid.{entity}.DeleteMenu",
    label: "Delete",
    scopes: ["HomepageGrid"],
    locationIds: ["homepagegrid-records"],
  },
  {
    commandIdTemplate: "Mscrm.AssignSelectedRecord",
    controlIdTemplate: "Mscrm.HomepageGrid.{entity}.Assign",
    idTemplate: "Mscrm.HomepageGrid.{entity}.Assign",
    label: "Assign",
    scopes: ["HomepageGrid"],
    locationIds: ["homepagegrid-actions"],
    sequence: 30,
  },
  {
    commandIdTemplate: "Mscrm.ShareSelectedRecord",
    controlIdTemplate: "Mscrm.HomepageGrid.{entity}.Share",
    idTemplate: "Mscrm.HomepageGrid.{entity}.Share",
    label: "Share",
    scopes: ["HomepageGrid"],
    locationIds: ["homepagegrid-collaborate"],
    sequence: 10,
  },
  {
    commandIdTemplate: "Mscrm.RefreshSelected",
    controlIdTemplate: "Mscrm.HomepageGrid.{entity}.Refresh",
    idTemplate: "Mscrm.HomepageGrid.{entity}.Refresh",
    label: "Refresh",
    scopes: ["HomepageGrid"],
    locationIds: ["homepagegrid-view"],
    sequence: 10,
  },
  {
    commandIdTemplate: "Mscrm.ExportToExcel",
    controlIdTemplate: "Mscrm.HomepageGrid.{entity}.ExportToExcel",
    idTemplate: "Mscrm.HomepageGrid.{entity}.ExportToExcel",
    label: "Export to Excel",
    scopes: ["HomepageGrid"],
    locationIds: ["homepagegrid-data"],
    sequence: 40,
    image16x16: "/_imgs/ribbon/exporttoexcel16.png",
    image32x32: "/_imgs/ribbon/exporttoexcel32.png",
    templateAlias: "o3",
  },
  {
    commandIdTemplate: "Mscrm.ExportSelectedToExcel",
    controlIdTemplate: "Mscrm.HomepageGrid.{entity}.ExportSelectedToExcel",
    idTemplate: "Mscrm.HomepageGrid.{entity}.ExportSelectedToExcel",
    label: "Export selected to Excel",
    scopes: ["HomepageGrid"],
    locationIds: ["homepagegrid-data"],
    sequence: 230,
  },
  {
    commandIdTemplate: "Mscrm.HomepageGrid.Activate",
    controlIdTemplate: "Mscrm.HomepageGrid.{entity}.Activate",
    idTemplate: "Mscrm.HomepageGrid.{entity}.Activate",
    label: "Activate",
    scopes: ["HomepageGrid"],
    locationIds: ["homepagegrid-records"],
    sequence: 30,
    image16x16: "/_imgs/ribbon/Activate_16.png",
    image32x32: "/_imgs/ribbon/Activate_32.png",
    templateAlias: "o2",
  },
  {
    commandIdTemplate: "Mscrm.HomepageGrid.Deactivate",
    controlIdTemplate: "Mscrm.HomepageGrid.{entity}.Deactivate",
    idTemplate: "Mscrm.HomepageGrid.{entity}.Deactivate",
    label: "Deactivate",
    scopes: ["HomepageGrid"],
    locationIds: ["homepagegrid-records"],
    sequence: 40,
    image16x16: "/_imgs/ribbon/Deactivate_16.png",
    image32x32: "/_imgs/ribbon/Deactivate_32.png",
    templateAlias: "o2",
  },
  {
    commandIdTemplate: "Mscrm.AddEmailToSelectedRecord",
    controlIdTemplate: "Mscrm.HomepageGrid.{entity}.SendDirectEmail",
    idTemplate: "Mscrm.HomepageGrid.{entity}.SendDirectEmail",
    label: "Send direct email",
    scopes: ["HomepageGrid"],
    locationIds: ["homepagegrid-collaborate"],
    sequence: 10,
  },
  {
    commandIdTemplate: "Mscrm.AddConnectionGrid",
    controlIdTemplate: "Mscrm.HomepageGrid.{entity}.AddConnection",
    idTemplate: "Mscrm.HomepageGrid.{entity}.AddConnection",
    label: "Connect",
    scopes: ["HomepageGrid"],
    locationIds: ["homepagegrid-actions"],
    sequence: 70,
  },
  {
    commandIdTemplate: "Mscrm.RunWorkflowSelected",
    controlIdTemplate: "Mscrm.HomepageGrid.{entity}.RunWorkflow",
    idTemplate: "Mscrm.HomepageGrid.{entity}.RunWorkflow",
    label: "Run workflow",
    scopes: ["HomepageGrid"],
    locationIds: ["homepagegrid-process"],
    sequence: 20,
  },
  {
    commandIdTemplate: "Mscrm.RunReportSelected",
    controlIdTemplate: "Mscrm.HomepageGrid.{entity}.RunReport",
    idTemplate: "Mscrm.HomepageGrid.{entity}.RunReport",
    label: "Run report",
    scopes: ["HomepageGrid"],
    locationIds: ["homepagegrid-process"],
    sequence: 10,
  },
  {
    commandIdTemplate: "Mscrm.ImportDataFromExcel",
    controlIdTemplate: "Mscrm.HomepageGrid.{entity}.ImportDataFromExcel",
    idTemplate: "Mscrm.HomepageGrid.{entity}.ImportDataFromExcel",
    label: "Import from Excel",
    scopes: ["HomepageGrid"],
    locationIds: ["homepagegrid-import"],
    sequence: 20,
  },
  {
    commandIdTemplate: "Mscrm.AddNewRecordFromSubGridStandard",
    controlIdTemplate: "Mscrm.SubGrid.{entity}.AddNewStandard",
    idTemplate: "Mscrm.SubGrid.{entity}.AddNewStandard",
    label: "Add new",
    scopes: ["SubGrid"],
    locationIds: ["subgrid-standard"],
    sequence: 20,
    image16x16: "/_imgs/ribbon/New_16.png",
    image32x32: "/_imgs/ribbon/newrecord32.png",
    templateAlias: "o1",
  },
  {
    commandIdTemplate: "Mscrm.AddExistingRecordFromSubGridStandard",
    controlIdTemplate: "Mscrm.SubGrid.{entity}.AddExistingStandard",
    idTemplate: "Mscrm.SubGrid.{entity}.AddExistingStandard",
    label: "Add existing",
    scopes: ["SubGrid"],
    locationIds: ["subgrid-standard"],
    sequence: 30,
    image16x16: "/_imgs/ribbon/AddExistingStandard_16.png",
    image32x32: "/_imgs/ribbon/AddExistingStandard_32.png",
    templateAlias: "o1",
  },
  {
    commandIdTemplate: "Mscrm.AddExistingRecordFromSubGridAssociated",
    controlIdTemplate: "Mscrm.SubGrid.{entity}.AddExistingAssoc",
    idTemplate: "Mscrm.SubGrid.{entity}.AddExistingAssoc",
    label: "Add existing associated",
    scopes: ["SubGrid"],
    locationIds: ["subgrid-standard"],
    sequence: 40,
  },
  {
    commandIdTemplate: "Mscrm.EditSelectedRecord",
    controlIdTemplate: "Mscrm.SubGrid.{entity}.Edit",
    idTemplate: "Mscrm.SubGrid.{entity}.Edit",
    label: "Edit",
    scopes: ["SubGrid"],
    locationIds: ["subgrid-actions"],
    sequence: 10,
  },
  {
    commandIdTemplate: "Mscrm.DeleteSelectedRecord",
    controlIdTemplate: "Mscrm.SubGrid.{entity}.Delete",
    idTemplate: "Mscrm.SubGrid.{entity}.Delete",
    label: "Remove",
    scopes: ["SubGrid"],
    locationIds: ["subgrid-actions"],
    sequence: 20,
  },
  {
    commandIdTemplate: "Mscrm.RefreshSelected",
    controlIdTemplate: "Mscrm.SubGrid.{entity}.Refresh",
    idTemplate: "Mscrm.SubGrid.{entity}.Refresh",
    label: "Refresh",
    scopes: ["SubGrid"],
    locationIds: ["subgrid-management"],
    sequence: 10,
  },
  {
    commandIdTemplate: "Mscrm.OpenAssociatedGridView",
    controlIdTemplate: "Mscrm.SubGrid.{entity}.OpenAssociatedGridView",
    idTemplate: "Mscrm.SubGrid.{entity}.OpenAssociatedGridView",
    label: "Open associated view",
    scopes: ["SubGrid"],
    locationIds: ["subgrid-management"],
    sequence: 10,
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
      id: applyEntity(command.idTemplate ?? command.commandIdTemplate, entityLogicalName),
      label: command.label,
      scopes: command.scopes,
      locationIds: command.locationIds,
      commandId: applyEntity(command.commandIdTemplate, entityLogicalName),
      controlId: command.controlIdTemplate
        ? applyEntity(command.controlIdTemplate, entityLogicalName)
        : undefined,
      sequence: command.sequence,
      image16x16: command.image16x16,
      image32x32: command.image32x32,
      templateAlias: command.templateAlias,
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
  return listOobRibbonCommands(undefined, entityLogicalName).find(
    (command) => command.id === id || command.commandId === id || command.controlId === id,
  );
}

function applyEntity(value: string, entityLogicalName: string): string {
  return value.replace(/\{entity\}/g, entityLogicalName);
}
