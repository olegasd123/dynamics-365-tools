we need to create VS Code extension, which allows us to publish web-resources to MS Dynamics CRM (XRM 365). 

* we need to have possibilities to work with different environments such as dev, test, prod, etc. The connection settings of them should be stored in the configuration.

* we need to have a possibility to bind a local folder to CRM from VS Code.
    For instance:

    use can see from the Explorer of VS Code, the tree of catalogs and folders:
    - new_
    -- account
    --- custom-grid
    ---- index.html
    ---- index.js
    --- form.js
    --- ribbon.js
    --- picture.png
    --- icon.svg
    - cmp_
    -- account
    --- form.js
    --- ribbon.js


    which will be corresponded of the web resource list on the CRM side:
    - new_/account/custom-grid/index.html
    - new_/account/custom-grid/index.js
    - new_/account/form.js
    - new_/account/ribbon.js
    - new_/account/picture.png
    - new_/account/icon.svg
    - cmp_/account/form.js
    - cmp_/account/ribbon.js

    ('new_', 'cmp_' are the prefixes of the solutions)

* user should be able to specify a folder to bind it and all its children, and each file separately also. All the bindings should be saved somewhere to provide a possibility to use it for the other members of the project.

* when user click on the file or folder in the Explorer of VS Code. it should be a new item in the dropdown menu.
    Let it be "XRM" with children items such as:
    - "Add into {selected solution}" if it hasn't been bound before.
    - "Update and Publish to" if it has. This item should have the children items: dev, test, prod, etc. It depends of how many environments have been specified in the configuration by the user.
    
* user should be able to specify the solution for adding new resources globally.

* Use modern technologies and approaches to build this extension. Use scalable architecture, because we'll add a possibility to publish assemblies too in the future, not now. Keep code clean.
