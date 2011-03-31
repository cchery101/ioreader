var routes = function() {
  var routes = [];

  this.parseRoute = function(path) {
    this.parseGroups = function(loc) {
      var nameRegexp = new RegExp(":([^/.]+)", "g"); 
      var newRegexp = "";
      var groups = {};
      var matches = null;
      var i = 0;
      var start = 0;
      while(matches = nameRegexp.exec(loc)) {
        groups[matches[1]] = i++;
        newRegexp += loc.substring(start, matches.index) + "([^/.]+)";
        start = matches.index + matches[1].length + 1;
      }

      return { "groups" : groups, "regexp": new RegExp(newRegexp)};
    };
      
    return this.parseGroups(path); 
  };

  var matchRoute = function(url) {
    var route = null;
    for(var i = 0; route = routes[i]; i ++) {
      var routeMatch = route.regex.regexp.exec(url);
      if(!!routeMatch == false) continue;
      
      var params = {};
      for(var g in route.regex.groups) {
        var group = route.regex.groups[g];
        params[g] = routeMatch[group + 1];
      }
      
      route.callback({"url": url, "params": params});
    }

    return;
  };

  this.get = function(route, callback) {
    routes.push({regex: this.parseRoute(route), "callback": callback});
  };

  this.test = function(url) {
    matchRoute(url);
  };

  var attach = function() {
    window.addEventListener("popstate", function(e) {
      matchRoute(document.location); 
    });
  };

  attach();
};
