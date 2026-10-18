Guide: target "chrome". Operate the user's own Google Chrome (or Edge): its tabs, with the user's sign-ins and cookies, through Microsoft's Playwright MCP server and its Playwright Extension. The actions are Playwright MCP's own tools without their browser_ prefix, with their own arguments.

Each action is sent as computer_use_agent(target="chrome", action="navigate", args={"url": "https://example.com"}), or several as actions=[…] (up to 20; they stop at the first error). The first action connects to Chrome: the extension asks the user which tab to share, unless a token is set in Settings (computer_use.chrome_extension_token), in which case it connects without asking.

Read the page with snapshot: it lists the page's elements, each with a ref. Point at an element with target set to that ref (element is a short human description of it). Use take_screenshot only when the layout matters.

The code mode below does not reach this target: send chrome actions as action or actions.
