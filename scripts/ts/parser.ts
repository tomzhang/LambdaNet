import {readFileSync} from "fs";
import * as ts from "typescript";
import {SyntaxKind} from "typescript";

/** The output format for the Scala side to parse */
class JNode {
    constructor(public nodeKind: string, public children: JNode[]) {
    }
}

function assertNotNull(v: any, msg: string = null) {
    if (v == null) {
        if (msg) {
            throw new Error("should not be null! Message: " + msg);
        } else {
            throw new Error("should not be null!");
        }
    }
}

// ASTs
type GMark = GType | null;
interface GType {
    category: string;
}

class TVar implements GType {
    public category = "TVar";

    constructor(public name: string) {
        assertNotNull(name)
    }
}

class AnyType implements GType {
    public category = "AnyType";
    public name: string = "any";

    private constructor() {
    }

    static instance = new AnyType();
}

export const anyType = AnyType.instance;

export function parseType(node: ts.TypeNode, checker: ts.TypeChecker): GType {
    //todo: handle other cases
    if (!node) {
        throw new Error("parse type on an empty node!")
    }
    // let string = node.getText();
    let string = checker.typeToString(checker.getTypeFromTypeNode(node));
    if (string == "any") return anyType;
    else return new TVar(string);
}


interface NamedExpr {
    name: String;
    expr: GExpr;
}

interface GExpr {
    category: string
}

class Var implements GExpr {
    category: string = "Var";

    constructor(public name: string) {
        assertNotNull(name);
    }
}

class Const implements GExpr {
    category: string = "Const";

    constructor(public value: string, public ty: GType) {
        assertNotNull(value);
    }
}

class FuncCall implements GExpr {
    category: string = "FuncCall";

    constructor(public f: GExpr, public args: GExpr[]) {
    }
}

class ObjLiteral implements GExpr {
    category: string = "ObjLiteral";

    constructor(public fields: NamedExpr[]) {
    }
}

class Access implements GExpr {
    category: string = "Access";

    constructor(public expr: GExpr, public field: string) {
        assertNotNull(field);
    }
}

class IfExpr implements GExpr {
    category: string = "IfExpr";

    constructor(public cond: GExpr, public e1: GExpr, public e2: GExpr) {
    }
}


export interface GStmt {
    category: string
}

class VarDef implements GStmt {
    category: string = "VarDef";

    constructor(public x: string, public mark: GMark,
                public init: GExpr, public isConst: boolean) {
    }
}

class AssignStmt implements GStmt {
    category: string = "AssignStmt";

    constructor(public lhs: GExpr, public rhs: GExpr) {
    }
}

class ExprStmt implements GStmt {
    category: string = "ExprStmt";

    constructor(public expr: GExpr, public isReturn: boolean) {
    }
}

class IfStmt implements GStmt {
    category: string = "IfStmt";

    constructor(public cond: GExpr, public branch1: GStmt, public branch2: GStmt) {
    }
}

class WhileStmt implements GStmt {
    category: string = "WhileStmt";

    constructor(public cond: GExpr, public body: GStmt) {
    }
}

class BlockStmt implements GStmt {
    category: string = "BlockStmt";

    constructor(public stmts: GStmt[]) {
    }
}

class FuncDef implements GStmt {
    category: string = "FuncDef";

    constructor(public name: string, public args: [string, string][], public returnType: string,
                public body: GStmt[]) {
    }
}

class ClassDef implements GStmt {
    category: string = "ClassDef";

    constructor(public name: string, public constructor: FuncDef, public vars: Object,
                public funcDefs: FuncDef[], public superType: string = null) {
    }
}

function tryFullyQualifiedName(node: ts.Node, checker: ts.TypeChecker): string {
    let symbol = checker.getSymbolAtLocation(node);
    let name: string = symbol ? checker.getFullyQualifiedName(symbol) : (<any>node)["text"];
    return name;
}


export function parseExpr(node: ts.Node, checker: ts.TypeChecker): GExpr {

    function rec(node: ts.Node): GExpr {
        switch (node.kind) {
            case SyntaxKind.Identifier:
                let name = tryFullyQualifiedName(node, checker);
                return new Var(name);
            case SyntaxKind.CallExpression: {
                let n = (<ts.CallExpression>node);
                let f = rec(n.expression);
                let args = n.arguments.map(rec);
                return new FuncCall(f, args);
            }
            case SyntaxKind.NewExpression: {
                let n = (<ts.NewExpression>node);
                let fName = "NEW-" + (<ts.Identifier>n.expression).text;
                let args = n.arguments.map(rec);
                return new FuncCall(new Var(fName), args);
            }
            case SyntaxKind.ObjectLiteralExpression: {
                let n = (<ts.ObjectLiteralExpression>node);
                let fields = n.properties.map((p: ts.ObjectLiteralElementLike) => {
                    return parseObjectLiteralElementLike(p);
                });
                return new ObjLiteral(fields);
            }
            case SyntaxKind.PropertyAccessExpression: {
                let n = node as ts.PropertyAccessExpression;
                let lhs = rec(n.expression);
                return new Access(lhs, n.name.text);
            }
            case ts.SyntaxKind.ElementAccessExpression: {
                let n = node as ts.ElementAccessExpression;
                let thing = rec(n.expression);
                let index = rec(n.argumentExpression);
                return new FuncCall(new Access(thing, "access"), [index]);
            }
            case ts.SyntaxKind.ConditionalExpression: {
                let n = node as ts.ConditionalExpression;
                let cond = parseExpr(n.condition, checker);
                let e1 = parseExpr(n.whenTrue, checker);
                let e2 = parseExpr(n.whenFalse, checker);
                return new IfExpr(cond, e1, e2);
            }
            case ts.SyntaxKind.ParenthesizedExpression: {
                let n = node as ts.ParenthesizedExpression;
                return rec(n.expression);
            }

            // constants
            case SyntaxKind.NumericLiteral:
                return constExpr("number");
            case SyntaxKind.StringLiteral:
                return constExpr("string");
            case SyntaxKind.TrueKeyword:
            case SyntaxKind.FalseKeyword:
                return constExpr("bool");
            case SyntaxKind.NullKeyword:
                return new Const("null", anyType);
            case SyntaxKind.ArrayLiteralExpression:
                return constExpr("array"); //todo: might need to distinguish array types

            // operators
            case ts.SyntaxKind.BinaryExpression: {
                let n = node as ts.BinaryExpression;
                let l = rec(n.left);
                let r = rec(n.right);
                let opp = n.operatorToken.kind;

                return new FuncCall(new Access(l, ts.SyntaxKind[opp]), [r]);
            }
            case SyntaxKind.PrefixUnaryExpression:
            case SyntaxKind.PostfixUnaryExpression:
                let n = <any>node;
                let opName = ts.SyntaxKind[n["operator"]];
                let fixity = (node.kind == SyntaxKind.PrefixUnaryExpression) ? "" : "POST_";
                let arg = parseExpr(n["operand"], checker);
                return new FuncCall(new Var(fixity + opName), [arg]);

            default:
                throw new Error("Unknown category: " + ts.SyntaxKind[node.kind]);
        }

        function constExpr(typeName: string) {
            // let v = (<ts.LiteralLikeNode>node).text;
            return new Const("CONST", new TVar(typeName));
        }

        function parseObjectLiteralElementLike(p: ts.ObjectLiteralElementLike): NamedExpr {
            let a = (<ts.PropertyAssignment>p);
            return {name: (<ts.StringLiteral>a.name).text, expr: rec(a.initializer)};
        }
    }

    return rec(node);
}

export function parseStmt(node: ts.Node, checker: ts.TypeChecker): GStmt[] {
    /** a program statement
     *
     * S :=                                    ([[GStmt]])
     *       var x: α = e                      ([[VarDef]])
     *       e := e                            ([[AssignStmt]])
     *       [return] e                        ([[ExprStmt]])
     *       if e then S else S                ([[IfStmt]])
     *       while e do S                      ([[WhileStmt]])
     * B in  { S; ...; S }                     ([[BlockStmt]])
     * f in  function x (x: α, ..., x:α): α B  ([[FuncDef]])
     *       class x (l: α, ..., l:α)          ([[ClassDef]])
     *       ↳ [extends x]{ f, ..., f }
     *
     * where x and l are [[Symbol]],
     *       α is [[GTMark]],
     *       e is [[GExpr]],
     * */
    function rec(node: ts.Node): GStmt[] {
        switch (node.kind) {
            case SyntaxKind.ExpressionStatement: {
                let n = <ts.ExpressionStatement>node;
                if (n.expression.kind == SyntaxKind.BinaryExpression) {
                    let e = n.expression as ts.BinaryExpression;
                    if (e.operatorToken.kind == ts.SyntaxKind.FirstAssignment) {
                        let l = parseExpr(e.left, checker);
                        let r = parseExpr(e.right, checker);
                        return [new AssignStmt(l, r)]
                    }
                }
                return [new ExprStmt(parseExpr(n.expression, checker), false)];
            }
            case SyntaxKind.ReturnStatement: {
                let n = <ts.ReturnStatement>node;
                return [new ExprStmt(parseExpr(n.expression, checker), true)];
            }
            case SyntaxKind.VariableStatement: {
                let list = (node as ts.VariableStatement).declarationList;
                return parseVarDecList(list);
            }
            case SyntaxKind.IfStatement: {
                let n = node as ts.IfStatement;
                let cond = parseExpr(n.expression, checker);
                let then = flattenBlock(rec(n.thenStatement));
                let otherwise: GStmt[];
                if (n.elseStatement == undefined) otherwise = [new BlockStmt([])];
                else otherwise = rec(n.elseStatement);
                return [new IfStmt(cond, then, flattenBlock(otherwise))]
            }
            case SyntaxKind.WhileStatement: {
                let n = node as ts.WhileStatement;
                let cond = parseExpr(n.expression, checker);
                let body = flattenBlock(rec(n.statement));
                return [new WhileStmt(cond, body)]
            }
            case SyntaxKind.Block: {
                let n = node as ts.Block;
                let stmts = flatMap(n.statements, rec);
                return [new BlockStmt(stmts)]
            }
            case ts.SyntaxKind.ForStatement:
                let n = node as ts.ForStatement;
                let cond = n.condition;
                let init = n.initializer;
                let outerBlock = new BlockStmt([]);

                if (ts.isVariableDeclarationList(init)) {
                    outerBlock.stmts = parseVarDecList(init);
                } else {
                    outerBlock.stmts.push(new ExprStmt(parseExpr(init, checker), false));
                }

                let incr = new ExprStmt(parseExpr(n.incrementor, checker), false);
                let bodyStmts: GStmt[] = rec(n.statement).concat([incr]);

                outerBlock.stmts.push(new WhileStmt(
                    parseExpr(cond, checker),
                    flattenBlock(bodyStmts)
                ));
                return [outerBlock];

            // case SyntaxKind.FunctionDeclaration: {
            //
            // }

            default:
                throw new Error("Unknown stmt category: " + ts.SyntaxKind[node.kind]);
        }
    }

    function parseVarDecList(node: ts.VariableDeclarationList): VarDef[] {
        let isConst = (node.flags & ts.NodeFlags.Const) != 0;

        let dec = node.declarations;

        return dec.map(x => {
            let mark: GMark = x.type ? parseType(x.type, checker): null;
            return new VarDef(
                (<ts.Identifier>x.name).text,
                mark,
                parseExpr(x.initializer, checker),
                isConst)
        });
    }

    function flattenBlock(stmts: GStmt[]): GStmt {
        if (stmts.length == 1) return stmts[0];
        else return new BlockStmt(stmts);
    }

    return rec(node);
}

export function parseFile(src: string, envFiles: string[]): GExpr {
    let program = ts.createProgram(envFiles, {
        target: ts.ScriptTarget.ES2018,
        module: ts.ModuleKind.CommonJS
    });

    let checker = program.getTypeChecker();
    let source_files = program.getSourceFiles().filter(f => f.fileName == src && !f.isDeclarationFile);
    return parseExpr(source_files[0], checker);
}


// utilities
export function flatMap<A, B>(xs: any, f: (x: A) => B[]): B[] {
    return xs.reduce((acc: any, x: A) => acc.concat(f(x)), []);
}