(function(jQuery) {
  "use strict";

  var $ = jQuery;

  /* This is some temporary code to provide some kind of 'remix'
   * functionality to the goggles, at least until we have the
   * real MixMaster tool ready. */

  function CommandManager(hud, focused) {
    var undoStack = [];
    var redoStack = [];

    function updateStatus(verb, command) {
      // TODO: We're assuming that 'verb' and 'command' are both already
      // HTML-escaped here, which isn't necessarily obvious. Might want
      // to escape them just in case.
      $(hud.overlay).html('<span>' + verb + ' ' + command.name + '.</span>');
    }

    function internalUndo() {
      var command = undoStack.pop();
      redoStack.push(command);
      command.undo();
      return command;
    }
    
    function internalRedo() {
      var command = redoStack.pop();
      undoStack.push(command);
      command.execute();
      return command;
    }
    
    var self = {
      run: function(command) {
        focused.unfocus();
        undoStack.push(command);
        redoStack.splice(0);
        command.execute();
        updateStatus('Busted', command);
      },
      undo: function() {
        if (undoStack.length) {
          focused.unfocus();
          updateStatus('Unbusted', internalUndo());
        } else
          $(hud.overlay).html('<span>Nothing left to undo!</span>');
      },
      redo: function() {
        if (redoStack.length) {
          focused.unfocus();
          updateStatus('Rebusted', internalRedo());
        } else
          $(hud.overlay).html('<span>Nothing left to redo!</span>');
      },
      serialize: function() {
        var commands = [];
        var timesUndone = 0;
        while (undoStack.length) {
          var cmd = undoStack[undoStack.length - 1];
          commands.push(cmd.serialize());
          internalUndo();
          timesUndone++;
        }
        for (var i = 0; i < timesUndone; i++)
          internalRedo();
        return commands;
      },
      deserialize: function(commands) {
        undoStack.splice(0);
        redoStack.splice(0);
        for (var i = 0; i < commands.length; i++) {
          undoStack.push(ReplaceWithCmd(commands[i]));
          internalUndo();
        }
        for (var i = 0; i < commands.length; i++)
          internalRedo();
      }
    };
    
    return self;
  }

  function ReplaceWithCmd(name, elementToReplace, newContent) {
    var isExecuted = false;

    function deserialize(state) {
      isExecuted = true;
      name = state.name;
      newContent = $(document.documentElement).find(state.selector);
      elementToReplace = $(state.html);
      if (newContent.length != 1)
        throw new Error("selector '" + state.selector + "' matches " +
                        newContent.length + " elements");
    }

    if (typeof(name) == "object" && !elementToReplace && !newContent)
      deserialize(name);

    return {
      name: name,
      execute: function() {
        if (isExecuted)
          throw new Error("command already executed");
        var overlay = $(elementToReplace).overlay();
        $(elementToReplace).replaceWith(newContent);
        overlay.applyTagColor(newContent, 0.25)
               .resizeToAndFadeOut(newContent);
        isExecuted = true;
      },
      undo: function() {
        if (!isExecuted)
          throw new Error("command not yet executed");
        var overlay = $(newContent).overlay();
        $(newContent).replaceWith(elementToReplace);
        overlay.applyTagColor(elementToReplace, 0.25)
               .resizeToAndFadeOut(elementToReplace);
        isExecuted = false;
      },
      serialize: function() {
        if (!isExecuted)
          throw new Error("only executed commands can be serialized");
        var trivialParent = $("<div></div>");
        trivialParent.append($(elementToReplace).clone());
        return {
          name: name,
          selector: $(document.documentElement).pathTo(newContent),
          html: trivialParent.html()
        };
      }
    };
  }

  function MixMaster(options) {
    var focused = options.focusedOverlay;
    var commandManager = CommandManager(options.hud, focused);

    var self = {
      undo: function() { commandManager.undo(); },
      redo: function() { commandManager.redo(); },
      saveHistoryToDOM: function saveHistoryToDOM() {
        $('#webxray-serialized-history-v1').remove();
        var serializedHistory = $('<div></div>');
        serializedHistory.attr('id', 'webxray-serialized-history-v1')
                         .text(self.serializeHistory()).hide();
        $(document.body).append(serializedHistory);
      },
      loadHistoryFromDOM: function loadHistoryFromDOM() {
        var serializedHistory = $('#webxray-serialized-history-v1');
        if (serializedHistory.length)
          self.deserializeHistory(serializedHistory.text());
      },
      serializeHistory: function serializeHistory() {
        return JSON.stringify(commandManager.serialize());
      },
      deserializeHistory: function deserializeHistory(history) {
        commandManager.deserialize(JSON.parse(history));
      },
      replaceFocusedElement: function replaceFocusedElement(html) {
        var elementToReplace = focused.ancestor || focused.element;
        if (elementToReplace) {
          if (html !== null && html != "") {
            if (html[0] != '<') {
              html = '<span>' + html + '</span>';
            }
            var newContent = $(html);
            commandManager.run(ReplaceWithCmd('replacement',
                                              elementToReplace,
                                              newContent));
          }
        }
      },
      deleteFocusedElement: function deleteFocusedElement() {
        var elementToDelete = focused.ancestor || focused.element;
        if (elementToDelete) {
          // Replacing the element with a zero-length invisible
          // span is a lot easier than actually deleting the element,
          // since it allows us to place a "bookmark" in the DOM
          // that can easily be undone if the user wishes.
          var placeholder = $('<span class="webxray-deleted"></span>');
          commandManager.run(ReplaceWithCmd('deletion', elementToDelete,
                                            placeholder));
        }
      },
      infoForFocusedElement: function infoForFocusedElement(open) {
        var element = focused.ancestor || focused.element;
        open = open || window.open;
        if (element) {
          var url = 'https://developer.mozilla.org/en/HTML/Element/' +
                    element.nodeName.toLowerCase();
          open(url, 'info');
        }
      },
      replaceFocusedElementWithAwesomeDialog: function(input, dialogURL,
                                                       body) {
        var MAX_HTML_LENGTH = 1000;
        var focusedElement =  focused.ancestor || focused.element;
        if (!focusedElement)
          return;
        var tagName = focusedElement.nodeName.toLowerCase();
        var clonedElement = $(focusedElement).clone();
        var trivialParent = $('<div></div>').append(clonedElement);
        var focusedHTML = trivialParent.html();

        if (focusedHTML.length == 0 || focusedHTML.length > MAX_HTML_LENGTH)
          focusedHTML = "<span>The HTML source for your selected " +
                        "<code>&lt;" + tagName + "&gt;</code> element " +
                        "could make your head explode.</span>";

        var dialog = jQuery.modalDialog({
          input: input,
          body: body,
          url: dialogURL + "#dialog"
        });

        dialog.iframe.bind("message", function onMessage(event, data) {
          if (data && data.length && data[0] == '{') {
            var data = JSON.parse(data);
            dialog.close(function() {
              if (data.msg == "ok") {

                // The dialog may have decided to replace all our spaces
                // with non-breaking ones, so we'll undo that.
                var html = data.endHTML.replace(/\u00a0/g, " ");

                self.replaceFocusedElement(html);
              }
            });
          }
        });
        dialog.iframe.one("load", function onLoad() {
          this.contentWindow.postMessage(JSON.stringify({
            title: "Compose A Replacement",
            instructions: "<span>When you're done composing your " +
                          "replacement HTML, press the " +
                          "<strong>Ok</strong> button.",
            startHTML: focusedHTML,
            baseURI: document.location.href
          }), "*");
          $(this).fadeIn();
        });
      }
    };
    return self;
  }

  jQuery.extend({mixMaster: MixMaster});
})(jQuery);
