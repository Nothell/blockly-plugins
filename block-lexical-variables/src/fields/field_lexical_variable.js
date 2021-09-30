// -*- mode: java; c-basic-offset: 2; -*-
// Copyright 2013-2014 MIT, All rights reserved
// Released under the Apache License, Version 2.0
// http://www.apache.org/licenses/LICENSE-2.0
/**
 * @license
 * @fileoverview Drop-down chooser of variables in the current lexical scope
 *     for App Inventor.
 * @author fturbak@wellesley.com (Lyn Turbak)
 */

'use strict';

import * as Blockly from 'blockly';
import '../msg';
import '../instrument';
import * as Shared from '../shared';

// TODO: Maybe make a single importable goog compatibility object
const goog = {
  provide: (_) => {
  },
  require: (_) => {
  },
  inherits: Blockly.utils.object.inherits,
  dom: Blockly.utils.dom,
  userAgent: Blockly.utils.userAgent,
  asserts: {
    assertObject: (_) => {
    },
  },
};

/**
 * Lyn's History:
 *  *  [lyn, written 11/15-17/13 but added 07/01/14] Overhauled parameter
 * renaming:
 *    + Refactored FieldLexicalVariable method getNamesInScope to have same
 * named function that works on any block, and a separate function
 * getLexicalNamesInScope that works on any block
 *    + Refactored monolithic renameParam into parts that are useful on their
 * own
 *    + Previously, renaming param from oldName to newName might require
 * renaming newName itself
 *      (adding a number to the end) to avoid renaming inner declarations that
 * might be captured by renaming oldName to newName. Now, there is a choice
 * between this previous behavior and a new behavior in which newName is *not*
 * renamed and capture is avoided by renaming the inner declarations when
 * necessary.
 *    + Created Blockly.Lexical.freeVariables for calculating free variables
 *    + Created Blockly.Lexical.renameBound for renaming of boundVariables in
 * declarations
 *    + Created Blockly.Lexical.renameFree for renaming of freeVariables in
 * declarations
 *    + Created Blockly.LexicalVariable.stringListsEqual for testing equality
 * of string lists.
 *  [lyn, 06/11/14] Modify checkIdentifier to work for i8n.
 *  [lyn, 04/13/14] Modify calculation of global variable names:
 *    1. Use getTopBlocks rather than getAllBlocks; the latter, in combination
 * with quadratic memory allocation space from Neil's getAllBlocks, was leading
 * to cubic memory allocation space, which led to lots of time wasted due to
 * allocation and GC. This change dramatically reduces allocation times and GC
 *    2. Introduce caching for
 * Blockly.WarningHandler.checkAllBlocksForWarningsAndErrors(). This change
 * reduces allocation times and GC even further.
 *  [lyn, 10/28/13] Made identifier legality check more restrictive by removing
 * arithmetic and logical ops as possible identifier characters
 *  [lyn, 10/27/13] Create legality filter & transformer for AI2 variable names
 *  [lyn, 10/26/13] Fixed renaming of globals and lexical vars involving empty
 * strings and names with internal spaces.
 *  [lyn, 12/23-27/12] Updated to:
 *     (1) handle renaming involving local declaration statements/expressions
 * and
 *     (2) treat name prefixes correctly when they're used.
 *  [lyn, 11/29/12] handle control constructs in getNamesInScope and
 * referenceResult
 *  [lyn, 11/24/12] Sort and remove duplicates from namespaces
 *  [lyn, 11/19/12]
 *    + renameGlobal renames global references and prevents duplicates in
 * global names;
 *    + renameParam is similar for procedure and loop names.
 *    + define referenceResult, which is renaming workhorse
 *  [lyn, 11/18/12] nameNotIn function for renaming by adding number at end
 *  [lyn, 11/10/12] getGlobalNames and getNamesInScope.
 */

// Get all global names

/**
 * Class for a variable's dropdown field.
 * @param {!string} varname The default name for the variable.  If null,
 *     a unique variable name will be generated.
 * @extends Blockly.FieldDropdown
 * @constructor
 */
Blockly.FieldLexicalVariable = function(varname) {
  // Call parent's constructor.
  Blockly.FieldDropdown.call(this, Blockly.FieldLexicalVariable.dropdownCreate,
      Blockly.FieldLexicalVariable.dropdownChange);
  if (varname) {
    this.doValueUpdate_(varname);
  } else {
    this.doValueUpdate_(Blockly.Variables.generateUniqueName());
  }
};

// FieldLexicalVariable is a subclass of FieldDropdown.
goog.inherits(Blockly.FieldLexicalVariable, Blockly.FieldDropdown);

/**
 * Set the variable name.
 * @param {string} text New text.
 */
Blockly.FieldLexicalVariable.prototype.setValue = function(text) {
  // Fix for issue #1901. If the variable name contains a space separating two
  // words, and the first isn't "global", then replace the first word with
  // global. This fixes an issue where the translated "global" keyword was
  // being stored instead of the English keyword, resulting in errors when
  // moving between languages in the App Inventor UI. NB: This makes an
  // assumption that we won't allow for multi-word variables in the future.
  // Right now variables identifiers still need to be a sequence of
  // non-whitespace characters, so only global variables will split on a space.
  if (text && text !== ' ') {
    const parts = text.split(' ');
    if (parts.length == 2 && parts[0] !== 'global') {
      text = 'global ' + parts[1];
    }
  }
  Blockly.FieldLexicalVariable.superClass_.setValue.call(this, text);
};

Blockly.FieldLexicalVariable.prototype.doClassValidation_ = function(
    opt_newValue) {
  return /** @type {string} */ (opt_newValue);
};

/**
 * Get the block holding this drop-down variable chooser.
 * @return {string} Block holding this drop-down variable chooser.
 */
Blockly.FieldLexicalVariable.prototype.getBlock = function() {
  return this.block_;
};

/**
 * Set the block holding this drop-down variable chooser.
 * @param {?Blockly.Block} block Block holding this drop-down variable chooser.
 */
Blockly.FieldLexicalVariable.prototype.setBlock = function(block) {
  this.block_ = block;
};

// [lyn, 11/10/12] Returns the names of all global definitions as a list of
// strings [lyn, 11/18/12] * Removed from prototype and stripped off "global"
// prefix (add it elsewhere) * Add optional excluded block argument as in
// Neil's code to avoid global declaration being created
Blockly.FieldLexicalVariable.getGlobalNames = function(optExcludedBlock) {
  // TODO: Maybe switch to injectable warning/error handling
  if (Blockly.Instrument.useLynCacheGlobalNames && Blockly.getMainWorkspace() &&
      Blockly.getMainWorkspace().getWarningHandler &&
      Blockly.getMainWorkspace().getWarningHandler().cacheGlobalNames) {
    return Blockly.getMainWorkspace().getWarningHandler().cachedGlobalNames;
  }
  const globals = [];
  if (Blockly.mainWorkspace) {
    let blocks = [];
    if (Blockly.Instrument.useLynGetGlobalNamesFix) {
      blocks = Blockly.mainWorkspace.getTopBlocks(); // [lyn, 04/13/14] Only
      // need top blocks, not
      // all blocks!
    } else {
      blocks = Blockly.mainWorkspace.getAllBlocks(); // [lyn, 11/10/12] Is
      // there a better way to
      // get workspace?
    }
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if ((block.type === 'global_declaration') &&
          (block != optExcludedBlock)) {
        globals.push(block.getFieldValue('NAME'));
      }
    }
  }
  return globals;
};

/**
 * @this A FieldLexicalVariable instance
 * @return {list} A list of all global and lexical names in scope at the point
 *     of the getter/setter block containing this FieldLexicalVariable
 *     instance. Global names are listed in sorted order before lexical names
 *     in sorted order.
 */
// [lyn, 12/24/12] Clean up of name prefixes; most work done earlier by paulmw
// [lyn, 11/29/12] Now handle params in control constructs
// [lyn, 11/18/12] Clarified structure of namespaces
// [lyn, 11/17/12]
// * Commented out loop params because AI doesn't handle loop variables
// correctly yet. [lyn, 11/10/12] Returns the names of all names in lexical
// scope for the block associated with this menu. including global variable
// names. * Each global name is prefixed with "global " * If
// Shared.showPrefixToUser is false, non-global names are not prefixed. * If
// Shared.showPrefixToUser is true, non-global names are prefixed with labels
// specified in blocklyeditor.js
Blockly.FieldLexicalVariable.prototype.getNamesInScope = function() {
  return Blockly.FieldLexicalVariable.getNamesInScope(this.block_);
};

/**
 * @param block
 * @return {Array.<Array.<string>>} A list of pairs representing the translated
 * and untranslated name of every variable in the scope of the current block.
 */
// [lyn, 11/15/13] Refactored to work on any block
Blockly.FieldLexicalVariable.getNamesInScope = function(block) {
  let globalNames = Blockly.FieldLexicalVariable.getGlobalNames(); // from
  // global
  // variable
  // declarations
  // [lyn, 11/24/12] Sort and remove duplicates from namespaces
  globalNames = Blockly.LexicalVariable.sortAndRemoveDuplicates(globalNames);
  globalNames = globalNames.map(function(name) {
    return [Shared.prefixGlobalMenuName(name), 'global ' + name];
  });
  const allLexicalNames = Blockly.FieldLexicalVariable.getLexicalNamesInScope(
      block);
  // Return a list of all names in scope: global names followed by lexical ones.
  return globalNames.concat(allLexicalNames);
};

/**
 * @param block
 * @return {Array.<Array.<string>>} A list of all lexical names (in sorted
 *     order) in scope at the point of the given block If
 *     Shared.usePrefixInYail is true, returns names prefixed with labels like
 *     "param", "local", "index"; otherwise returns unprefixed names.
 */
// [lyn, 11/15/13] Factored this out from getNamesInScope to work on any block
Blockly.FieldLexicalVariable.getLexicalNamesInScope = function(block) {
  const procedureParamNames = []; // from procedure/function declarations
  const loopNames = []; // from for loops
  const rangeNames = []; // from range loops
  const localNames = []; // from local variable declaration
  let allLexicalNames = []; // all non-global names
  const innermostPrefix = {}; // paulmw's mechanism for keeping track of
  // innermost prefix in case
  // where prefix is an annotation rather than a separate namespace
  let parent;
  let child;
  let params;
  let i;

  // [lyn, 12/24/2012] Abstract over name handling
  /**
   * @param name
   * @param list
   * @param prefix
   */
  function rememberName(name, list, prefix) {
    list.push(name);
    if (!innermostPrefix[name]) {
      // only set this if not already set from an inner scope.
      innermostPrefix[name] = prefix;
    }
  }

  child = block;
  if (child) {
    parent = child.getParent();
    if (parent) {
      while (parent) {
        // TODO: Maybe change this logic to instead call a function on the
        // block.
        if ((parent.type === 'procedures_defnoreturn') ||
            (parent.type === 'procedures_defreturn')) {
          params = parent.declaredNames(); // [lyn, 10/13/13] Names from block,
          // not arguments_ instance var
          for (i = 0; i < params.length; i++) {
            rememberName(params[i], procedureParamNames,
                Shared.procedureParameterPrefix);
          }
        } else if ((parent.type === 'controls_forEach') &&
            (parent.getInputTargetBlock('DO') == child)) {
          // Only DO is in scope, not other inputs!
          const loopName = parent.getFieldValue('VAR');
          rememberName(loopName, loopNames, Shared.loopParameterPrefix);
        } else if ((parent.type === 'controls_forRange' ||
                    parent.type === 'controls_for') &&
            (parent.getInputTargetBlock('DO') == child)) {
          // Only DO is in scope, not other inputs!
          const rangeName = parent.getFieldValue('VAR');
          rememberName(rangeName, rangeNames, Shared.loopRangeParameterPrefix);
        } else if ((parent.type === 'local_declaration_expression' &&
                parent.getInputTargetBlock('RETURN') == child) ||
            // only body is in scope of names
            (parent.type === 'local_declaration_statement' &&
                parent.getInputTargetBlock('STACK') == child)) {
          params = parent.declaredNames(); // [lyn, 10/13/13] Names from block,
          // not localNames_ instance var
          for (i = 0; i < params.length; i++) {
            rememberName(params[i], localNames, Shared.localNamePrefix);
          }
        }
        child = parent;
        parent = parent.getParent(); // keep moving up the chain.
      }
    }
  }

  if (!Shared.usePrefixInYail) { // Only a single namespace
    allLexicalNames = procedureParamNames.concat(loopNames)
        .concat(rangeNames)
        .concat(localNames);
    allLexicalNames =
        Blockly.LexicalVariable.sortAndRemoveDuplicates(allLexicalNames);
    // Add prefix as annotation only when Shared.showPrefixToUser is true
    allLexicalNames = allLexicalNames.map(
        function(name) {
          // return ((possiblyPrefixNameWith(Shared.menuSeparator))
          // (innermostPrefix[name])) (name);
          return (Shared.possiblyPrefixMenuNameWith(innermostPrefix[name]))(
              name);
        },
    );
  } else { // multiple namespaces distinguished by prefixes
    // note: correctly handles case where some prefixes are the same
    allLexicalNames =
        procedureParamNames.map(
            Shared.possiblyPrefixMenuNameWith(Shared.procedureParameterPrefix))
            .concat(loopNames.map(
                Shared.possiblyPrefixMenuNameWith(Shared.loopParameterPrefix)))
            .concat(rangeNames.map(Shared.possiblyPrefixMenuNameWith(
                Shared.loopRangeParameterPrefix)))
            .concat(localNames.map(
                Shared.possiblyPrefixMenuNameWith(Shared.localNamePrefix)));
    allLexicalNames =
        Blockly.LexicalVariable.sortAndRemoveDuplicates(allLexicalNames);
  }
  return allLexicalNames.map(function(name) {
    return [name, name];
  });
};

/**
 * Return a sorted list of variable names for variable dropdown menus.
 * @return {!Array.<string>} Array of variable names.
 * @this {!Blockly.FieldLexicalVariable}
 */
Blockly.FieldLexicalVariable.dropdownCreate = function() {
  const variableList = this.getNamesInScope(); // [lyn, 11/10/12] Get all
  // global, parameter, and local
  // names
  return variableList.length == 0 ? [[' ', ' ']] : variableList;
};

/*
TODO: I'm leaving the following in for now (but commented) because at one point
  it seemed necessary.  It doesn't seem so anymore but I just want to remember
  in case it really was needed.
*/
// Blockly.FieldLexicalVariable.dropdownCreate = function() {
//   var variableList = this.getNamesInScope(); // [lyn, 11/10/12] Get all
// global, parameter, and local names variableList = variableList.length == 0 ?
// [[' ', ' ']] : variableList; const extraNames = []; const block =
// this.getBlock(); if (block) { const flydown =
// block.workspace.getTopWorkspace().getFlydown(); const flydownWorkspace =
// flydown.getWorkspace(); if (flydownWorkspace === block.workspace) { const
// currentVariableName = flydown.field_.getValue();
// extraNames.push([currentVariableName, currentVariableName]); } } return
// variableList.concat(extraNames); };

/**
 * Update the value of this dropdown field.
 * @param {*} newValue The value to be saved.
 * @protected
 */
Blockly.FieldLexicalVariable.prototype.doValueUpdate_ = function(newValue) {
  Blockly.FieldDropdown.superClass_.doValueUpdate_.call(this, newValue);
  // Note that we are asking getOptions to add newValue to the list of available
  // options.  We do that essentially to force callers up the chain to accept
  // newValue as an option.  This could potentially cause trouble, but it seems
  // to be ok for our use case.  It is ugly, though, since it bypasses an aspect
  // of the normal dropdown validation.
  const options =
      this.getOptions(true, [[newValue, newValue]]);
  for (let i = 0, option; (option = options[i]); i++) {
    if (option[1] == this.value_) {
      this.selectedOption_ = option;
    }
  }
  this.forceRerender();
};

/**
 * Return a list of the options for this dropdown.
 * @param {boolean=} opt_useCache For dynamic options, whether or not to use the
 *     cached options or to re-generate them.
 * @param {boolean=} opt_extraOption A possible extra option to add.
 * @return {!Array<!Array>} A non-empty array of option tuples:
 *     (human-readable text or image, language-neutral name).
 * @throws {TypeError} If generated options are incorrectly structured.
 */
Blockly.FieldLexicalVariable.prototype.getOptions = function(opt_useCache,
    opt_extraOption) {
  if (Array.isArray(opt_useCache)) {
    opt_extraOption = opt_useCache;
  }
  const extraOption = opt_extraOption || [];
  if (this.isOptionListDynamic()) {
    if (!this.generatedOptions_ || !opt_useCache) {
      this.generatedOptions_ =
          this.menuGenerator_.call(this).concat(extraOption);
      Blockly.FieldDropdown.validateOptions_(this.generatedOptions_);
    }
    return this.generatedOptions_.concat(extraOption);
  }
  return /** @type {!Array<!Array<string>>} */ (this.menuGenerator_);
};

/**
 * Event handler for a change in variable name.
 * // [lyn, 11/10/12] *** Not clear this needs to do anything for lexically
 * scoped variables. Special case the 'New variable...' and 'Rename
 * variable...' options. In both of these special cases, prompt the user for a
 * new name.
 * @param {string} text The selected dropdown menu option.
 * @this {!Blockly.FieldLexicalVariable}
 */
Blockly.FieldLexicalVariable.dropdownChange = function(text) {
  if (text) {
    this.doValueUpdate_(text);
    const topWorkspace = this.sourceBlock_.workspace.getTopWorkspace();
    if (topWorkspace.getWarningHandler) {
      topWorkspace.getWarningHandler().checkErrors(this.sourceBlock_);
    }
  }
  // window.setTimeout(Blockly.Variables.refreshFlyoutCategory, 1);
};


// [lyn, 11/18/12]
/**
 * Possibly add a digit to name to disintguish it from names in list.
 * Used to guarantee that two names aren't the same in situations that prohibit
 * this.
 * @param {string} name Proposed name.
 * @param {string list} nameList List of names with which name can't conflict.
 * @return {string} Non-colliding name.
 */
Blockly.FieldLexicalVariable.nameNotIn = function(name, nameList) {
  // First find the nonempty digit suffixes of all names in nameList that have
  // the same prefix as name e.g. for name "foo3" and nameList = ["foo",
  // "bar4", "foo17", "bar" "foo5"] suffixes is ["17", "5"]
  const namePrefixSuffix = Blockly.FieldLexicalVariable.prefixSuffix(name);
  const namePrefix = namePrefixSuffix[0];
  const nameSuffix = namePrefixSuffix[1];
  let emptySuffixUsed = false; // Tracks whether "" is a suffix.
  let isConflict = false; // Tracks whether nameSuffix is used
  const suffixes = [];
  for (let i = 0; i < nameList.length; i++) {
    const prefixSuffix = Blockly.FieldLexicalVariable.prefixSuffix(nameList[i]);
    const prefix = prefixSuffix[0];
    const suffix = prefixSuffix[1];
    if (prefix === namePrefix) {
      if (suffix === nameSuffix) {
        isConflict = true;
      }
      if (suffix === '') {
        emptySuffixUsed = true;
      } else {
        suffixes.push(suffix);
      }
    }
  }
  if (!isConflict) {
    // There is no conflict; just return name
    return name;
  } else if (!emptySuffixUsed) {
    // There is a conflict, but empty suffix not used, so use that
    return namePrefix;
  } else {
    // There is a possible conflict and empty suffix is not an option.
    // First sort the suffixes as numbers from low to high
    const suffixesAsNumbers = suffixes.map(function(elt, i, arr) {
      return parseInt(elt, 10);
    });
    suffixesAsNumbers.sort(function(a, b) {
      return a - b;
    });
    // Now find smallest number >= 2 that is unused
    let smallest = 2; // Don't allow 0 or 1 an indices
    let index = 0;
    while (index < suffixesAsNumbers.length) {
      if (smallest < suffixesAsNumbers[index]) {
        return namePrefix + smallest;
      } else if (smallest == suffixesAsNumbers[index]) {
        smallest++;
        index++;
      } else { // smallest is greater; move on to next one
        index++;
      }
    }
    // Only get here if exit loop
    return namePrefix + smallest;
  }
};

/**
 * Split name into digit suffix and prefix before it.
 * Return two-element list of prefix and suffix strings. Suffix is empty if no
 * digits.
 * @param {string} name Input string.
 * @return {string[]} Two-element list of prefix and suffix.
 */
Blockly.FieldLexicalVariable.prefixSuffix = function(name) {
  const matchResult = name.match(/^(.*?)(\d+)$/);
  if (matchResult) {
    // List of prefix and suffix
    return [matchResult[1], matchResult[2]];
  } else {
    return [name, ''];
  }
};

/**
 * Constructs a FieldLexicalVariable from a JSON arg object.
 * @param {!Object} options A JSON object with options.
 * @return {Blockly.FieldLexicalVariable} The new field instance.
 * @package
 * @nocollapse
 */
Blockly.FieldLexicalVariable.fromJson = function(options) {
  const name = Blockly.utils.replaceMessageReferences(options['name']);
  return new Blockly.FieldLexicalVariable(name);
};

Blockly.fieldRegistry.register('field_lexical_variable',
    Blockly.FieldLexicalVariable);

Blockly.LexicalVariable = {};

// [lyn, 11/19/12] Rename global to a new name.
//
// [lyn, 10/26/13] Modified to replace sequences of internal spaces by
// underscores (none were allowed before), and to replace empty string by '_'.
// Without special handling of empty string, the connection between a
// declaration field and its references is lots.
Blockly.LexicalVariable.renameGlobal = function(newName) {
  // this is bound to field_textinput object
  const oldName = this.value_;

  // [lyn, 10/27/13] now check legality of identifiers
  newName = Blockly.LexicalVariable.makeLegalIdentifier(newName);

  this.sourceBlock_.getField('NAME').doValueUpdate_(newName);

  const globals = Blockly.FieldLexicalVariable.getGlobalNames(
      this.sourceBlock_);
  // this.sourceBlock excludes block being renamed from consideration
  // Potentially rename declaration against other occurrences
  newName = Blockly.FieldLexicalVariable.nameNotIn(newName, globals);
  if (this.sourceBlock_.rendered) {
    // Rename getters and setters
    if (Blockly.mainWorkspace) {
      const blocks = Blockly.mainWorkspace.getAllBlocks();
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const renamingFunction = block.renameLexicalVar;
        if (renamingFunction) {
          renamingFunction.call(block,
              Shared.GLOBAL_KEYWORD + Shared.menuSeparator + oldName,
              Shared.GLOBAL_KEYWORD + Shared.menuSeparator + newName,
              Blockly.Msg.LANG_VARIABLES_GLOBAL_PREFIX + Shared.menuSeparator +
              oldName,
              Blockly.Msg.LANG_VARIABLES_GLOBAL_PREFIX + Shared.menuSeparator +
              newName);
        }
      }
    }
  }
  return newName;
};

/**
 * Rename the old name currently in this field to newName in the block assembly
 * rooted at the source block of this field (where "this" names the field of
 * interest). See the documentation for renameParamFromTo for more details.
 * @param newName
 * @return {string} The (possibly changed version of) newName, which may be
 *     changed to avoid variable capture with both external declarations
 *     (declared above the declaration of this name) or internal declarations
 *     (declared inside the scope of this name).
 */
// [lyn, 11/19/12 (revised 10/11/13)]
// Rename procedure parameter, local name, or loop index variable to a new
// name,
// avoiding variable capture in the scope of the param. Consistently renames
// all
// references to the name in getter and setter blocks. The proposed new name
// may be changed (by adding numbers to the end) so that it does not conflict
// with existing names. Returns the (possibly changed) new name.
//
// [lyn, 10/26/13] Modified to replace sequences of internal spaces by
// underscores (none were allowed before), and to replace empty string by '_'.
// Without special handling of empty string, the connection between a
// declaration field and its references is lost.  [lyn, 11/15/13] Refactored
// monolithic renameParam into parts that are useful on their own
Blockly.LexicalVariable.renameParam = function(newName) {
  const htmlInput = this.htmlInput_;
  // this is bound to field_textinput object
  const oldName = this.getValue() ||
      (htmlInput && htmlInput.defaultValue) ||
      this.getText(); // name being changed to newName

  // [lyn, 10/27/13] now check legality of identifiers
  newName = Blockly.LexicalVariable.makeLegalIdentifier(newName);

  // Default behavior consistent with previous behavior is to use "false" for
  // last argument -- I.e., will not rename inner declarations, but may rename
  // newName
  return Blockly.LexicalVariable.renameParamFromTo(this.sourceBlock_, oldName,
      newName, false);
  // Default should be false (as above), but can also play with true:
  // return Blockly.LexicalVariable.renameParamFromTo(this.sourceBlock_,
  // oldName, newName, true);
};

/**
 * [lyn, written 11/15/13, installed 07/01/14]
 * Refactored from renameParam and extended.
 * Rename oldName to newName in the block assembly rooted at this block
 * (where "this" names the block of interest). The names may refer to any
 * nonglobal parameter name (procedure parameter, local name, or loop index
 * variable). This function consistently renames all references to oldName by
 * newName in all getter and setter blocks that refer to oldName, correctly
 * handling inner declarations that use oldName. In cases where renaming
 * oldName to newName would result in variable capture of newName by another
 * declaration, such capture is avoided by either:
 *    1. (If renameCapturables is true):  consistently renaming the capturing
 * declarations
 *       (by adding numbers to the end) so that they do not conflict with
 * newName (or each other).
 *    2. (If renameCapturables is false): renaming the proposed newName (by
 * adding numbers to the end) so that it does not conflict with capturing
 * declarations).
 * @param block  the root source block containing the parameter being renamed
 * @param oldName
 * @param newName
 * @param renameCapturables in capture situations, determines whether capturing
 *     declarations are renamed (true) or newName is renamed (false)
 * @return {string} if renameCapturables is true, returns the given newName;
 *     if renameCapturables is false, returns the (possibly renamed version of)
 *     newName, which may be changed to avoid variable capture with both
 *     external declarations (declared above the declaration of this name) or
 *     internal declarations (declared inside the scope of this name).
 */
Blockly.LexicalVariable.renameParamFromTo =
    function(block, oldName, newName, renameCapturables) {
      // Handle mutator blocks specially
      if (block.type && block.type.indexOf('mutator') != -1) {
        return Blockly.LexicalVariable.renameParamWithoutRenamingCapturables(
            block, oldName, newName, []);
      } else if (renameCapturables) {
        Blockly.LexicalVariable.renameParamRenamingCapturables(block, oldName,
            newName);
        return newName;
      } else {
        return Blockly.LexicalVariable.renameParamWithoutRenamingCapturables(
            block, oldName, newName, []);
      }
    };

/**
 * [lyn, written 11/15/13, installed 07/01/14]
 * Rename oldName to newName in the block assembly rooted at this block.
 * In the case where newName would be captured by an internal declaration,
 *  consistently rename the declaration and all its uses to avoid variable
 * capture. In the case where newName would be captured by an external
 * declaration, throw an exception.
 * @param sourceBlock  the root source block containing the declaration of
 *     oldName
 * @param oldName
 * @param newName
 */
Blockly.LexicalVariable.renameParamRenamingCapturables =
    function(sourceBlock, oldName, newName) {
      if (newName !== oldName) { // Do nothing if names are the same
        const namesDeclaredHere = sourceBlock.declaredNames ?
            sourceBlock.declaredNames() : [];
        if (namesDeclaredHere.indexOf(oldName) == -1) {
          throw Error('Blockly.LexicalVariable.renamingCapturables: oldName ' +
              oldName +
              ' is not in declarations {' + namesDeclaredHere.join(',') + '}');
        }
        const namesDeclaredAbove = [];
        Blockly.FieldLexicalVariable.getNamesInScope(sourceBlock)
            .map(function(pair) {
              if (pair[0] == pair[1]) {
                namesDeclaredAbove.push(pair[0]);
              } else {
                namesDeclaredAbove.push(pair[0], pair[1]);
              }
            }); // uses translated param names
        const declaredNames = namesDeclaredHere.concat(namesDeclaredAbove);
        // Should really check which forbidden names are free vars in the body
        // of declBlock.
        if (declaredNames.indexOf(newName) != -1) {
          throw Error(
              'Blockly.LexicalVariable.renameParamRenamingCapturables:' +
              ' newName ' +
              newName +
              ' is in existing declarations {' + declaredNames.join(',') + '}');
        } else {
          if (sourceBlock.renameBound) {
            const boundSubstitution = Blockly.Substitution.simpleSubstitution(
                oldName, newName);
            const freeSubstitution = new Blockly.Substitution(); // an empty
            // substitution
            sourceBlock.renameBound(boundSubstitution, freeSubstitution);
          } else {
            throw Error(
                'Blockly.LexicalVariable.renameParamRenamingCapturables:' +
                ' block ' +
                sourceBlock.type +
                ' is not a declaration block.');
          }
        }
      }
    };

/**
 * [lyn, written 11/15/13, installed 07/01/14]
 * Rename all free variables in this block according to the given renaming.
 * @param block: any block
 * @param block
 * @param freeSubstitution
 * @param freeRenaming: a dictionary (i.e., object) mapping old names to new
 *     names
 */
Blockly.LexicalVariable.renameFree = function(block, freeSubstitution) {
  if (block) { // If block is falsey, do nothing.
    if (block.renameFree) { // should be defined on every declaration block
      block.renameFree(freeSubstitution);
    } else {
      block.getChildren().map(function(blk) {
        Blockly.LexicalVariable.renameFree(blk, freeSubstitution);
      });
    }
  }
};

/**
 * [lyn, written 11/15/13, installed 07/01/14]
 * Return a nameSet of all free variables in the given block.
 * @param block
 * @return (NameSet) set of all free names in block
 */
Blockly.LexicalVariable.freeVariables = function(block) {
  let result = [];
  if (!block) {
    // input and next block slots might not empty
    result = new Blockly.NameSet();
  } else if (block.freeVariables) {
    // should be defined on every declaration block
    result = block.freeVariables();
  } else {
    const nameSets = block.getChildren().map(function(blk) {
      return Blockly.LexicalVariable.freeVariables(blk);
    });
    result = Blockly.NameSet.unionAll(nameSets);
  }
  // console.log("freeVariables(" + (block ? block.type : "*empty-socket*") +
  // ") = " + result.toString());
  return result;
};

/**
 * [lyn, written 11/15/13, installed 07/01/14] Refactored from renameParam
 * Rename oldName to newName in the block assembly rooted at this block.
 * In the case where newName would be captured by internal or external
 * declaration, change it to a name (with a number suffix) that would not be
 * captured.
 * @param sourceBlock  the root source block containing the declaration of
 *     oldName
 * @param oldName
 * @param newName
 * @param OKNewNames
 * @return {string} the (possibly renamed version of) newName, which may be
 *     changed to avoid variable capture with both external declarations
 *     (declared above the declaration of this name) or internal declarations
 *     (declared inside the scope of this name).
 */
Blockly.LexicalVariable.renameParamWithoutRenamingCapturables =
    function(sourceBlock, oldName, newName, OKNewNames) {
      if (oldName === newName) {
        return oldName;
      }
      sourceBlock.declaredNames ? sourceBlock.declaredNames() : [];
      let sourcePrefix = '';
      if (Shared.showPrefixToUser) {
        const type = sourceBlock.type;
        if (type === 'procedures_mutatorarg' ||
            type === 'procedures_defnoreturn' ||
            type === 'procedures_defreturn') {
          sourcePrefix = Shared.procedureParameterPrefix;
        } else if (type === 'controls_forEach') {
          sourcePrefix = Shared.loopParameterPrefix;
        } else if (type === 'controls_forRange' ||
                   type === 'controls_for') {
          sourcePrefix = Shared.loopRangeParameterPrefix;
        } else if (type === 'local_declaration_statement' ||
            type === 'local_declaration_expression' ||
            type === 'local_mutatorarg') {
          sourcePrefix = Shared.localNamePrefix;
        }
      }
      const helperInfo =
          Blockly.LexicalVariable.renameParamWithoutRenamingCapturablesInfo(
              sourceBlock, oldName, sourcePrefix);
      const blocksToRename = helperInfo[0];
      const capturables = helperInfo[1];
      let declaredNames = []; // declared names in source block, with which
      // newName cannot conflict
      if (sourceBlock.declaredNames) {
        declaredNames = sourceBlock.declaredNames();
        // Remove oldName from list of names. We can rename oldName to itself
        // if we desire!
        const oldIndex = declaredNames.indexOf(oldName);
        if (oldIndex != -1) {
          declaredNames.splice(oldIndex, 1);
        }
        // Remove newName from list of declared names if it's in OKNewNames.
        if (OKNewNames.indexOf(newName) != -1) {
          const newIndex = declaredNames.indexOf(newName);
          if (newIndex != -1) {
            declaredNames.splice(newIndex, 1);
          }
        }
      }
      const conflicts = Blockly.LexicalVariable.sortAndRemoveDuplicates(
          capturables.concat(declaredNames));
      newName = Blockly.FieldLexicalVariable.nameNotIn(newName, conflicts);

      // Special case: if newName is oldName, we're done!
      if (!(newName === oldName)) {
        // [lyn, 12/27/2012] I don't understand what this code is for.
        //  I think it had something to do with locals that has now been
        // repaired?
        /* var oldNameInDeclaredNames = false;
          for (var i = 0; i < declaredNames.length; i++) {
          if(oldName === declaredNames[i]){
            oldNameInDeclaredNames = true;
          }
        }
        if(!oldNameInDeclaredNames){
        */
        const oldNameValid = (declaredNames.indexOf(oldName) != -1);
        if (!oldNameValid) {
          // Rename getters and setters
          for (let i = 0; i < blocksToRename.length; i++) {
            const block = blocksToRename[i];
            const renamingFunction = block.renameLexicalVar;
            if (renamingFunction) {
              renamingFunction.call(block,
                  (Shared.possiblyPrefixMenuNameWith(sourcePrefix))(oldName),
                  (Shared.possiblyPrefixMenuNameWith(sourcePrefix))(newName));
            }
          }
        }
      }
      return newName;
    };

/**
 * [lyn, written 11/15/13, installed 07/01/14] Refactored from renameParam().
 * @param sourceBlock
 * @param oldName
 * @param sourcePrefix
 * @return {pair} Returns a pair of
 * (1) All getter/setter blocks that reference oldName
 * (2) A list of all non-global names to which oldName cannot be renamed
 *     because doing so would change the reference "wiring diagram" and thus
 *     the meaning of the program. This is the union of:
 * (a) all names declared between the declaration of oldName and a reference to
 *     old name; and
 * (b) all names declared in a parent of the oldName declaration that are
 *     referenced in the scope of oldName. In the case where prefixes are used
 *     (e.g., "param a", "index i, "local x") this is a list of *unprefixed*
 *     names.
 */
Blockly.LexicalVariable.renameParamWithoutRenamingCapturablesInfo =
    function(sourceBlock, oldName, sourcePrefix) {
      // var sourceBlock = this; // The block containing the declaration of
      // oldName sourceBlock is block in which name is being changed. Can be
      // one of:
      //   * For procedure param: procedures_mutatorarg, procedures_defnoreturn,
      //     procedures_defreturn (last two added by lyn on 10/11/13).
      //   * For local name: local_mutatorarg, local_declaration_statement,
      //     local_declaration_expression
      //   * For loop name: controls_forEach, controls_forRange, controls_for
      let inScopeBlocks = []; // list of root blocks in scope of oldName and in
      // which
      // renaming must take place.
      if (sourceBlock.blocksInScope) { // Find roots of blocks in scope.
        inScopeBlocks = sourceBlock.blocksInScope();
      }
      // console.log("inScopeBlocksRoots: " + JSON.stringify(inScopeBlocks.map(
      // function(elt) { return elt.type; })));

      // referenceResult is Array of (0) list of getter/setter blocks refering
      // to old name and (1) capturable names = names to which oldName cannot
      // be renamed without changing meaning of program.
      const referenceResults = inScopeBlocks.map(function(blk) {
        return Blockly.LexicalVariable.referenceResult(blk, oldName,
            sourcePrefix, []);
      });
      let blocksToRename = []; // A list of all getter/setter blocks whose that
      // reference oldName
      // and need to have their name changed to newName
      let capturables = []; // A list of all non-global names to which oldName
      // cannot be renamed because doing
      // so would change the reference "wiring diagram" and thus the meaning
      // of the program. This is the union of:
      // (1) all names declared between the declaration of oldName and a
      // reference to old name; and (2) all names declared in a parent of the
      // oldName declaration that are referenced in the scope of oldName. In
      // the case where prefixes are used (e.g., "param a", "index i, "local
      // x") this is a list of *unprefixed* names.
      for (let r = 0; r < referenceResults.length; r++) {
        blocksToRename = blocksToRename.concat(referenceResults[r][0]);
        capturables = capturables.concat(referenceResults[r][1]);
      }
      capturables =
          Blockly.LexicalVariable.sortAndRemoveDuplicates(capturables);
      return [blocksToRename, capturables];
    };

/**
 * [lyn, 10/27/13]
 * Checks an identifier for validity. Validity rules are a simplified version
 * of Kawa identifier rules. They assume that the YAIL-generated version of the
 * identifier will be preceded by a legal Kawa prefix:
 *
 * <identifier> = <first><rest>*
 * <first> = letter U charsIn("_$?~@")
 * <rest> = <first> U digit.
 *
 * Note: an earlier version also allowed characters in "!&%.^/+-*>=<",
 * but we decided to remove these because (1) they may be used for arithmetic,
 * logic, and selection infix operators in a future AI text language, and we
 * don't want things like a+b, !c, d.e to be ambiguous between variables and
 * other expressions.
 * (2) using chars in "><&" causes HTML problems with getters/setters in
 * flydown menu.
 *
 * First transforms the name by removing leading and trailing whitespace and
 * converting nonempty sequences of internal whitespace to '_'.
 * Returns a result object of the form {transformed: <string>, isLegal:
 * <bool>}, where: result.transformed is the transformed name and
 * result.isLegal is whether the transformed named satisfies the above rules.
 * @param ident
 * @return {{isLegal: boolean, transformed: string}}
 */
Blockly.LexicalVariable.checkIdentifier = function(ident) {
  const transformed = ident.trim() // Remove leading and trailing whitespace
      .replace(/[\s\xa0]+/g, '_'); // Replace nonempty sequences of internal
  // spaces by underscores
  // [lyn, 06/11/14] Previous definition focused on *legal* characters:
  //
  //    var legalRegexp = /^[a-zA-Z_\$\?~@][\w_\$\?~@]*$/;
  //
  // Unfortunately this is geared only to English, and prevents i8n names (such
  // as Chinese identifiers). In order to handle i8n, focus on avoiding illegal
  // chars rather than accepting only legal ones. This is a quick solution.
  // Needs more careful thought to work for every language. In particular, need
  // to look at results of Java's Character.isJavaIdentifierStart(int) and
  // Character.isJavaIdentifierPart(int) Note: to take complement of character
  // set, put ^ first. Note: to include '-' in character set, put it first or
  // right after ^
  const legalRegexp = /^[^-0-9!&%^/>=<`'"#:;,\\*+.()|{}[\] ][^-!&%^/>=<'"#:;,\\*+.()|{}[\] ]*$/;
  // " Make Emacs Happy
  const isLegal = transformed.search(legalRegexp) == 0;
  return {isLegal: isLegal, transformed: transformed};
};

Blockly.LexicalVariable.makeLegalIdentifier = function(ident) {
  const check = Blockly.LexicalVariable.checkIdentifier(ident);
  if (check.isLegal) {
    return check.transformed;
  } else if (check.transformed === '') {
    return '_';
  } else {
    return 'name'; // Use identifier 'name' to replace illegal name
  }
};

// [lyn, 11/19/12] Given a block, return an Array of
//   (0) all getter/setter blocks referring to name in block and its children
//   (1) all (unprefixed) names within block that would be captured if name
// were renamed to one of those names. If Shared.showPrefixToUser, prefix is
// the prefix associated with name; otherwise prefix is "". env is a list of
// internally declared names in scope at this point; if Shared.usePrefixInYail
// is true, the env names have prefixes, otherwise they do not. [lyn,
// 12/25-27/2012] Updated to (1) add prefix argument, (2) handle local
// declaration statements/expressions, and (3) treat prefixes correctly when
// they're used.
Blockly.LexicalVariable.referenceResult = function(block, name, prefix, env) {
  if (!block) { // special case when block is null
    return [[], []];
  }
  // [lyn, 11/29/12] Added forEach and forRange loops
  let referenceResults = []; // For collected reference results in subblocks
  // Handle constructs that can introduce names here specially (should figure
  // out a better way to generalize this!)
  if (block.type === 'controls_forEach') {
    let loopVar = block.getFieldValue('VAR');
    // Invariant: Shared.showPrefixToUser must also be true!
    if (Shared.usePrefixInYail) {
      loopVar = (Shared.possiblyPrefixMenuNameWith(Shared.loopParameterPrefix))(
          loopVar);
    }
    const newEnv = env.concat([loopVar]);
    const listResults = Blockly.LexicalVariable.referenceResult(
        block.getInputTargetBlock('LIST'), name, prefix, env);
    const doResults = Blockly.LexicalVariable.referenceResult(
        block.getInputTargetBlock('DO'), name, prefix, newEnv);
    const nextResults = Blockly.LexicalVariable.referenceResult(
        Blockly.LexicalVariable.getNextTargetBlock(block), name, prefix, env);
    referenceResults = [listResults, doResults, nextResults];
  } else if (block.type === 'controls_forRange' ||
             block.type === 'controls_for') {
    let loopVar = block.getFieldValue('VAR');
    // Invariant: Shared.showPrefixToUser must also be true!
    if (Shared.usePrefixInYail) {
      loopVar =
          (Shared.possiblyPrefixMenuNameWith(Shared.loopRangeParameterPrefix))(
              loopVar);
    }
    const newEnv = env.concat([loopVar]);
    const startResults = Blockly.LexicalVariable.referenceResult(
        block.getInputTargetBlock('START'), name, prefix, env);
    const endResults = Blockly.LexicalVariable.referenceResult(
        block.getInputTargetBlock('END'), name, prefix, env);
    const stepResults = Blockly.LexicalVariable.referenceResult(
        block.getInputTargetBlock('STEP'), name, prefix, env);
    const doResults = Blockly.LexicalVariable.referenceResult(
        block.getInputTargetBlock('DO'), name, prefix, newEnv);
    const nextResults = Blockly.LexicalVariable.referenceResult(
        Blockly.LexicalVariable.getNextTargetBlock(block), name, prefix, env);
    referenceResults =
        [startResults, endResults, stepResults, doResults, nextResults];
  } else if ((block.type === 'local_declaration_statement') ||
      (block.type === 'local_declaration_expression')) {
    // Collect locally declared names ...
    const localDeclNames = [];
    for (let i = 0; block.getInput('DECL' + i); i++) {
      let localName = block.getFieldValue('VAR' + i);
      // Invariant: Shared.showPrefixToUser must also be true!
      if (Shared.usePrefixInYail) {
        localName = (Shared.possiblyPrefixMenuNameWith(Shared.localNamePrefix))(
            localName);
      }
      localDeclNames.push(localName);
    }
    const newEnv = env.concat(localDeclNames); // ... and add to environment
    // Collect locally initialization expressions:
    const localInits = [];
    for (let i = 0; block.getInput('DECL' + i); i++) {
      const init = block.getInputTargetBlock('DECL' + i);
      if (init) {
        localInits.push(init);
      }
    }
    const initResults = localInits.map(function(init) {
      return Blockly.LexicalVariable.referenceResult(init, name, prefix, env);
    });
    if (block.type === 'local_declaration_statement') {
      const doResults = Blockly.LexicalVariable.referenceResult(
          block.getInputTargetBlock('STACK'), name, prefix, newEnv);
      const nextResults = Blockly.LexicalVariable.referenceResult(
          Blockly.LexicalVariable.getNextTargetBlock(block), name, prefix, env);
      referenceResults = initResults.concat([doResults, nextResults]);
    } else { // (block.type === "local_declaration_expression") {
      const returnResults = Blockly.LexicalVariable.referenceResult(
          block.getInputTargetBlock('RETURN'), name, prefix, newEnv);
      referenceResults = initResults.concat([returnResults]);
    }
  } else { // General case for blocks that do not introduce new names
    referenceResults = block.getChildren().map(function(blk) {
      return Blockly.LexicalVariable.referenceResult(blk, name, prefix, env);
    });
  }
  let blocksToRename = [];
  let capturables = [];
  for (let r = 0; r < referenceResults.length; r++) {
    blocksToRename = blocksToRename.concat(referenceResults[r][0]);
    capturables = capturables.concat(referenceResults[r][1]);
  }
  // Base case: getters/setters is where all the interesting action occurs
  if ((block.type === 'lexical_variable_get') ||
      (block.type === 'lexical_variable_set')) {
    const possiblyPrefixedReferenceName = block.getField('VAR').getText();
    const unprefixedPair = Shared.unprefixName(possiblyPrefixedReferenceName);
    const referencePrefix = unprefixedPair[0];
    const referenceName = unprefixedPair[1];
    const referenceNotInEnv = ((Shared.usePrefixInYail &&
            (env.indexOf(possiblyPrefixedReferenceName) == -1)) ||
        ((!Shared.usePrefixInYail) && (env.indexOf(referenceName) == -1)));
    if (!(referencePrefix === Blockly.Msg.LANG_VARIABLES_GLOBAL_PREFIX)) {
      if ((referenceName === name) && referenceNotInEnv) {
        // if referenceName refers to name and not some intervening
        // declaration, it's a reference to be renamed:
        blocksToRename.push(block);
        // Any intervening declared name with the same prefix as the searched
        // for name can be captured:
        if (Shared.usePrefixInYail) {
          for (let i = 0; i < env.length; i++) {
            // env is a list of prefixed names.
            const unprefixedEntry = Shared.unprefixName(env[i]);
            if (prefix === unprefixedEntry[0]) {
              capturables.push(unprefixedEntry[1]);
            }
          }
        } else { // Shared.usePrefixInYail
          capturables = capturables.concat(env);
        }
      } else if (referenceNotInEnv &&
          (!Shared.usePrefixInYail || prefix === referencePrefix)) {
        // If reference is not in environment, it's externally declared and
        // capturable When Shared.usePrefixInYail is true, only consider names
        // with same prefix to be capturable
        capturables.push(referenceName);
      }
    }
  }
  return [blocksToRename, capturables];
};

Blockly.LexicalVariable.sortAndRemoveDuplicates = function(strings) {
  const sorted = strings.sort();
  const nodups = [];
  if (strings.length >= 1) {
    let prev = sorted[0];
    nodups.push(prev);
    for (let i = 1; i < sorted.length; i++) {
      if (!(sorted[i] === prev)) {
        prev = sorted[i];
        nodups.push(prev);
      }
    }
  }
  return nodups;
};

// [lyn, 11/23/12] Given a block, return the block connected to its next
// connection; If there is no next connection or no block, return null.
Blockly.LexicalVariable.getNextTargetBlock = function(block) {
  if (block && block.nextConnection && block.nextConnection.targetBlock()) {
    return block.nextConnection.targetBlock();
  } else {
    return null;
  }
};

/**
 * [lyn, 11/16/13] Created.
 * @param strings1: An array of strings.
 * @param strings1
 * @param strings2
 * @param strings2: An array of strings.
 * @return True iff strings1 and strings2 have the same names in the same
 *     order; false otherwise.
 */
Blockly.LexicalVariable.stringListsEqual = function(strings1, strings2) {
  const len1 = strings1.length;
  const len2 = strings2.length;
  if (len1 !== len2) {
    return false;
  } else {
    for (let i = 0; i < len1; i++) {
      if (strings1[i] !== strings2[i]) {
        return false;
      }
    }
  }
  return true; // get here iff lists are equal
};